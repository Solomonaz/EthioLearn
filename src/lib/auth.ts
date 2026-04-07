import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import crypto from "crypto";
import { db } from "./db";
import { verifyOTP } from "./otp-store";
import { createUserSession, touchSession } from "./session-store";

// ── Telegram Auth Validation ─────────────────────────────────────────────────

/**
 * Validates the HMAC-SHA256 signature sent by the Telegram Login Widget.
 * See: https://core.telegram.org/widgets/login#checking-authorization
 */
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

      // Ensure proper type assertions
      const phoneVal = credentials.phoneNumber;
      const otpVal = credentials.otp;

      // Special check for .env configured Super Admin
      if (
        process.env.SUPER_ADMIN_PHONE && 
        process.env.SUPER_ADMIN_OTP && 
        phoneVal === process.env.SUPER_ADMIN_PHONE &&
        otpVal === process.env.SUPER_ADMIN_OTP
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

      const isValid = verifyOTP(phoneVal, otpVal);
      if (!isValid) return null;

      const user = await db.user.findUnique({
        where: { phoneNumber: phoneVal },
      });
      if (!user || !user.isActive || user.suspendedAt) return null;

      return {
        id: user.id,
        name: user.name,
        phone: user.phoneNumber,
        role: user.role,
        grade: user.grade,
        xpLevel: user.xpLevel,
        totalPoints: user.totalPoints,
      };
    },
  }),
];

// ── Google OAuth (optional) ────────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

// ── Telegram Login Widget (optional) ──────────────────────────────────────
if (process.env.TELEGRAM_BOT_TOKEN) {
  providers.push(
    CredentialsProvider({
      id: "telegram",
      name: "Telegram",
      credentials: {
        telegramData: { label: "Telegram Data", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.telegramData) return null;

        try {
          const data = JSON.parse(credentials.telegramData) as Record<string, string>;

          // 1. Validate HMAC signature
          if (!validateTelegramAuth(data)) return null;

          // 2. Reject stale auth (older than 1 hour)
          const authDate = parseInt(data.auth_date ?? "0");
          if (Date.now() / 1000 - authDate > 3600) return null;

          // 3. Look up our user by Telegram ID
          const telegramId = String(data.id);
          const user = await db.user.findFirst({
            where: { telegramId } as any,
          });

          if (!user || !user.isActive || user.suspendedAt) return null;

          return {
            id: user.id,
            name: user.name,
            phone: user.phoneNumber,
            role: user.role,
            grade: user.grade,
            xpLevel: user.xpLevel,
            totalPoints: user.totalPoints,
          };
        } catch {
          return null;
        }
      },
    })
  );
}

// ── Auth Options ─────────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 15 * 60,       // Access token: 15 minutes (SRS §4.1.2)
    updateAge: 10 * 60,    // NextAuth re-signs the cookie after 10 minutes
  },
  pages: {
    signIn: "/login",
    newUser: "/register",
  },
  providers,

  callbacks: {
    // ── signIn ───────────────────────────────────────────────────────────────
    async signIn({ account, profile }) {
      if (account?.provider === "google" && profile?.email) {
        // Only allow Google sign-in for users who have already registered
        // and linked their email address to their account.
        const existingUser = await db.user.findUnique({
          where: { email: profile.email },
        });

        if (!existingUser) {
          // Redirect to login page with a descriptive error
          return "/login?error=GoogleAccountNotLinked";
        }

        // Lazily save the Google ID (sub) for future sign-ins
        const sub = (profile as { sub?: string }).sub ?? account.providerAccountId;
        if (sub && !(existingUser as any).googleId) {
          await db.user
            .update({ where: { id: existingUser.id }, data: { googleId: sub } as any })
            .catch(() => {});
        }
      }
      return true;
    },

    // ── jwt ──────────────────────────────────────────────────────────────────
    async jwt({ token, user, account }) {
      // ── Step 1: Fresh sign-in (user object is present) ──────────────────
      if (user) {
        if (account?.provider === "google") {
          // Map the Google-authenticated user to our DB user via email
          const dbUser = await db.user.findUnique({
            where: { email: user.email! },
          });
          if (dbUser) {
            token.id         = dbUser.id;
            token.role       = dbUser.role;
            token.phone      = dbUser.phoneNumber;
            token.grade      = dbUser.grade;
            token.xpLevel    = dbUser.xpLevel;
            token.totalPoints = dbUser.totalPoints;
          }
        } else {
          // Credentials provider (Phone OTP or Telegram)
          const u = user as unknown as {
            id: string; role: string; phone: string;
            grade: number | null; xpLevel: number; totalPoints: number;
          };
          token.id          = u.id;
          token.role        = u.role;
          token.phone       = u.phone;
          token.grade       = u.grade;
          token.xpLevel     = u.xpLevel;
          token.totalPoints = u.totalPoints;
        }

        // Create a DB session record (enables revocation & session management)
        if (token.id) {
          try {
            const session = await createUserSession(token.id as string);
            token.sessionId = session.sessionId;
          } catch {
            // Non-fatal: session tracking failure must not block sign-in
          }
        }
      }

      // ── Step 2: Touch the existing session (fire-and-forget) ─────────────
      // Full revocation check is done in getCurrentUser() to avoid DB hit on
      // every JWT encode cycle.
      if (token.sessionId) {
        touchSession(token.sessionId as string);
      }

      return token;
    },

    // ── session ──────────────────────────────────────────────────────────────
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as unknown as {
          id: string; role: string; phone: string;
          grade: number | null; xpLevel: number; totalPoints: number;
        };
        u.id          = token.id as string;
        u.role        = token.role as string;
        u.phone       = token.phone as string;
        u.grade       = token.grade as number | null;
        u.xpLevel     = token.xpLevel as number;
        u.totalPoints = token.totalPoints as number;

        // Expose sessionId to the client so it can identify the current session
        (session as typeof session & { sessionId?: string }).sessionId =
          token.sessionId as string | undefined;
      }
      return session;
    },
  },
};
