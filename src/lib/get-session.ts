import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { db } from "./db";

export async function getCurrentUser() {
  const cookieStore = await cookies();

  // Support both http (dev) and https (prod) cookie names
  const sessionToken =
    cookieStore.get("next-auth.session-token")?.value ??
    cookieStore.get("__Secure-next-auth.session-token")?.value;

  if (!sessionToken) return null;

  const token = await decode({
    token: sessionToken,
    secret: process.env.NEXTAUTH_SECRET!,
  });

  if (!token?.id) return null;

  const user = await db.user.findUnique({
    where: { id: token.id as string },
    include: { school: true },
  });

  // Deactivated or suspended accounts are treated as unauthenticated
  if (user && (!user.isActive || user.suspendedAt)) return null;

  return user;
}
