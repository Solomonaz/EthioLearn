import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import FacebookProvider from "next-auth/providers/facebook";
import crypto from "crypto";
import { db } from "./db";
import { peekOTP, consumeOTP } from "./otp-store";
import { createUserSession, touchSession, revokeSessionByToken } from "./session-store";

// ── Telegram Auth Validation ─────────────────────────────────────────────────

function validateTelegramAuth(data: Record<string, string>): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const { hash, ...fields } = data;
  if (!hash) return false;

  const dataCheckString = Object.keys(fields)
    .filter((k) => fields[k] !== undefined && fields[k] !== "")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return computedHash === hash;
}

// ── Shared social-login user lookup / auto-create ────────────────────────────

async function resolveSocialUser(
  provider: "google" | "facebook",
  providerId: string,
  email: string | null | undefined,
  name: string | null | undefined,
) {
  const idField = provider === "google" ? "googleId" : "facebookId";
  const fallbackName = provider === "google" ? "Google User" : "Facebook User";

  // 1. Look up by provider ID first (fastest, most reliable)
  let user = await db.user.findFirst({ where: { [idField]: providerId } as any });

  // 2. Fall back to email lookup (existing account linked by email)
  if (!user && email) {
    user = await db.user.findUnique({ where: { email } });
  }

  // 3. Auto-create a new account
  if (!user) {
    user = await db.user.create({
      data: {
        email:    email ?? null,
        name:     name?.trim() || fallbackName,
        [idField]: providerId,
        role:     "STUDENT",
      } as any,
    });
  } else if (!(user as any)[idField]) {
    // Lazily back-fill provider ID on existing account
    await db.user
      .update({ where: { id: user.id }, data: { [idField]: providerId } as any })
      .catch(() => {});
  }

  return user;
}

// ── Build Provider List ──────────────────────────────────────────────────────

const providers: NextAuthOptions["providers"] = [
  // ── Phone OTP (primary) ────────────────────────────────────────────────────
  CredentialsProvider({
    id: "credentials",
    name: "Phone OTP",
    credentials: {
      phoneNumber: { label: "Phone Number", type: "tel" },
      otp: { label: "OTP", type: "text" },
    },
    async authorize(credentials) {
      if (!credentials?.phoneNumber || !credentials?.otp) return null;

      const phoneVal = credentials.phoneNumber;
      const otpVal   = credentials.otp;

      // Super Admin shortcut
      if (
        process.env.SUPER_ADMIN_PHONE &&
        process.env.SUPER_ADMIN_OTP &&
        phoneVal === process.env.SUPER_ADMIN_PHONE &&
        otpVal   === process.env.SUPER_ADMIN_OTP
      ) {
        return {
          id: "env_super_admin",
          name: "System Super Admin",
          phone: phoneVal,
          role: "SUPER_ADMIN",
          grade: null,
          xpLevel: 0,
          totalPoints: 0,
        };
      }

      const isValid = await peekOTP(phoneVal, otpVal);
      if (!isValid) return null;

      const user = await db.user.findUnique({ where: { phoneNumber: phoneVal } });
      if (!user || !user.isActive || user.suspendedAt) return null;

      await consumeOTP(phoneVal);

      return {
        id:           user.id,
        name:         user.name,
        phone:        user.phoneNumber,
        role:         user.role,
        grade:        user.grade,
        xpLevel:      user.xpLevel,
        totalPoints:  user.totalPoints,
      };
    },
  }),

  // ── Email OTP ─────────────────────────────────────────────────────────────
  CredentialsProvider({
    id: "email-otp",
    name: "Email OTP",
    credentials: {
      email: { label: "Email", type: "email" },
      otp:   { label: "OTP",   type: "text"  },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.otp) return null;

      const email = credentials.email.toLowerCase().trim();
      const otp   = credentials.otp;

      const isValid = await peekOTP(email, otp);
      if (!isValid) throw new Error("InvalidOTP");

      const user = await db.user.findUnique({ where: { email } });
      if (!user) throw new Error("NoAccount");
      if (!user.isActive || user.suspendedAt) return null;

      await consumeOTP(email);

      return {
        id:          user.id,
        name:        user.name,
        email:       user.email,
        phone:       user.phoneNumber,
        role:        user.role,
        grade:       user.grade,
        xpLevel:     user.xpLevel,
        totalPoints: user.totalPoints,
      };
    },
  }),
];

// ── Google OAuth ───────────────────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

// ── Facebook OAuth ─────────────────────────────────────────────────────────
if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
  providers.push(
    FacebookProvider({
      clientId:     process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    })
  );
}

// ── Telegram Login Widget ──────────────────────────────────────────────────
if (process.env.TELEGRAM_BOT_TOKEN) {
  providers.push(
    CredentialsProvider({
      id: "telegram",
      name: "Telegram",
      credentials: {
        telegramData: { label: "Telegram Data", type: "text" },
        // "login"    → only find existing account, throw NoAccount if not found
        // "register" → only create new account, throw AlreadyExists if found
        action: { label: "Action", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.telegramData) return null;

        const action = (credentials.action as string) === "register"
          ? "register"
          : "login"; // default to login (safe: no auto-creation)

        try {
          const data = JSON.parse(credentials.telegramData) as Record<string, string>;

          if (!validateTelegramAuth(data)) return null;

          const authDate = parseInt(data.auth_date ?? "0");
          const nowSecs = Date.now() / 1000;
          // Reject if missing, NaN, in the future (>60s tolerance), or older than 1 hour
          if (!authDate || isNaN(authDate) || authDate > nowSecs + 60 || nowSecs - authDate > 3600) return null;

          const telegramId = String(data.id);
          const existing = await db.user.findFirst({ where: { telegramId } as any });

          if (action === "login") {
            // ── Login path: account must already exist ─────────────────────
            if (!existing) throw new Error("NoAccount");
            if (!existing.isActive || existing.suspendedAt) return null;

            const profileIncomplete = !existing.grade;
            return {
              id:    existing.id,
              name:  existing.name,
              phone: (existing as any).phoneNumber ?? null,
              role:  existing.role,
              grade: existing.grade,
              xpLevel:      existing.xpLevel,
              totalPoints:  existing.totalPoints,
              profileIncomplete,
            } as any;
          }

          // ── Register path: account must NOT already exist ──────────────
          if (existing) throw new Error("AlreadyExists");

          const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ");

          // Build an internal phone-number-slot identifier from the Telegram
          // username (globally unique on Telegram).  Falls back to the numeric
          // Telegram ID when the user has no username set.
          // Format: "telegram@solomon"  or  "telegram@id874952384"
          // This value is NEVER displayed to users — it is for DB uniqueness only.
          const tgIdentifier = data.username
            ? `telegram@${data.username.toLowerCase()}`
            : `telegram@id${telegramId}`;

          const newUser = await db.user.create({
            data: {
              name:        fullName || "Telegram User",
              telegramId,
              phoneNumber: tgIdentifier,
              role:        "STUDENT",
            } as any,
          });

          return {
            id:    newUser.id,
            name:  newUser.name,
            phone: null,
            role:  newUser.role,
            grade: null,
            xpLevel:          0,
            totalPoints:      0,
            profileIncomplete: true, // new user always needs grade
          } as any;
        } catch (err: any) {
          // Re-throw known errors so NextAuth passes them to the client
          if (err?.message === "NoAccount" || err?.message === "AlreadyExists") {
            throw err;
          }
          return null;
        }
      },
    })
  );
}

// ── Auth Options ─────────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  session: {
    strategy:    "jwt",
    maxAge:      15 * 60,
    updateAge:   10 * 60,
  },
  pages: {
    signIn:  "/login",
    newUser: "/register",
  },
  providers,

  events: {
    async signOut({ token }: { token: any }) {
      const sessionId = token?.sessionId as string | undefined;
      if (sessionId) await revokeSessionByToken(sessionId);
    },
  },

  callbacks: {
    // ── signIn ───────────────────────────────────────────────────────────────
    async signIn({ account, profile }) {
      if (
        (account?.provider === "google" || account?.provider === "facebook") &&
        profile
      ) {
        try {
          const providerId =
            (profile as any).sub ??
            (profile as any).id ??
            account.providerAccountId;

          await resolveSocialUser(
            account.provider as "google" | "facebook",
            String(providerId),
            profile.email,
            profile.name,
          );
        } catch {
          return false;
        }
      }
      return true;
    },

    // ── jwt ──────────────────────────────────────────────────────────────────
    async jwt({ token, user, account }) {
      // ── Step 1: Fresh sign-in ──────────────────────────────────────────────
      if (user) {
        if (account?.provider === "google" || account?.provider === "facebook") {
          // Look up the DB user we created/found in signIn callback
          const dbUser = await db.user.findUnique({
            where: { email: user.email! },
          });
          if (dbUser) {
            token.id           = dbUser.id;
            token.role         = dbUser.role;
            token.phone        = dbUser.phoneNumber;
            token.email        = dbUser.email;
            token.grade        = dbUser.grade;
            token.xpLevel      = dbUser.xpLevel;
            token.totalPoints  = dbUser.totalPoints;
            // Profile is incomplete until the user picks a grade
            token.profileIncomplete = !dbUser.grade;
          }
        } else {
          // Credentials providers (Phone OTP, Email OTP, Telegram)
          const u = user as unknown as {
            id: string; role: string; phone: string | null;
            grade: number | null; xpLevel: number; totalPoints: number;
            profileIncomplete?: boolean;
          };
          token.id              = u.id;
          token.role            = u.role;
          token.phone           = u.phone;
          token.grade           = u.grade;
          token.xpLevel         = u.xpLevel;
          token.totalPoints     = u.totalPoints;
          token.profileIncomplete = u.profileIncomplete ?? false;
        }

        // Create DB session record
        if (token.id) {
          try {
            const session = await createUserSession(token.id as string);
            token.sessionId = session.sessionId;
          } catch {
            // Non-fatal
          }
        }
      }

      // ── Step 2: On refresh, clear profileIncomplete once grade is saved ────
      if (!user && token.profileIncomplete && token.id) {
        const dbUser = await db.user.findUnique({
          where: { id: token.id as string },
          select: { phoneNumber: true, grade: true },
        });
        // Profile is complete once grade is set (all providers)
        const isComplete = !!dbUser?.grade;
        if (isComplete) {
          token.profileIncomplete = false;
          token.phone = dbUser?.phoneNumber ?? token.phone;
          token.grade = dbUser?.grade ?? token.grade;
        }
      }

      // ── Step 3: Touch session ──────────────────────────────────────────────
      if (token.sessionId) {
        touchSession(token.sessionId as string);
      }

      return token;
    },

    // ── session ──────────────────────────────────────────────────────────────
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as any;
        u.id           = token.id;
        u.role         = token.role;
        u.phone        = token.phone;
        u.email        = token.email ?? session.user.email;
        u.grade        = token.grade;
        u.xpLevel      = token.xpLevel;
        u.totalPoints  = token.totalPoints;
        u.profileIncomplete = token.profileIncomplete;

        (session as any).sessionId = token.sessionId;
      }
      return session;
    },
  },
};
