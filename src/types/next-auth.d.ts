import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /** The sessionId is exposed so the settings page can identify the current session */
    sessionId?: string;
    user: {
      id: string;
      role: string;
      phone: string;
      grade: number | null;
      xpLevel: number;
      totalPoints: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    phone: string;
    grade: number | null;
    xpLevel: number;
    totalPoints: number;
    /** DB session ID used for revocation tracking (§4.1.2) */
    sessionId?: string;
  }
}
