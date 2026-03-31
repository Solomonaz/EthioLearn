import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "./db";
import { verifyOTP } from "./otp-store";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
    newUser: "/register",
  },
  providers: [
    CredentialsProvider({
      name: "Phone OTP",
      credentials: {
        phoneNumber: { label: "Phone Number", type: "tel" },
        otp: { label: "OTP", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.phoneNumber || !credentials?.otp) {
          return null;
        }

        // Verify OTP (dev mode accepts "123456")
        const isValid = verifyOTP(credentials.phoneNumber, credentials.otp);
        if (!isValid) {
          return null;
        }

        const user = await db.user.findUnique({
          where: { phoneNumber: credentials.phoneNumber },
        });

        if (!user) {
          return null;
        }

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
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as {
          id: string;
          role: string;
          phone: string;
          grade: number | null;
          xpLevel: number;
          totalPoints: number;
        };
        token.id = u.id;
        token.role = u.role;
        token.phone = u.phone;
        token.grade = u.grade;
        token.xpLevel = u.xpLevel;
        token.totalPoints = u.totalPoints;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as unknown as {
          id: string;
          role: string;
          phone: string;
          grade: number | null;
          xpLevel: number;
          totalPoints: number;
        };
        u.id = token.id as string;
        u.role = token.role as string;
        u.phone = token.phone as string;
        u.grade = token.grade as number | null;
        u.xpLevel = token.xpLevel as number;
        u.totalPoints = token.totalPoints as number;
      }
      return session;
    },
  },
};
