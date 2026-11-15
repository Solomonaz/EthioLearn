import { db } from "./db";
import { deleteStudents } from "./delete-student";

/** Days an email sign-up has to confirm its address before it is removed. */
export const UNVERIFIED_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Find self-registered student accounts whose email was never confirmed.
 *
 * Email sign-up saves the account before the confirmation link is clicked, so
 * fake or mistyped addresses pile up and keep that email taken. Those accounts
 * can never sign in (email sign-in requires a confirmed address).
 *
 * A real student who later changes their email ALSO ends up unconfirmed, so an
 * account is only removed when it shows no sign of ever having been used:
 * no sign-in session, quiz, exam attempt, note, saved graph, achievement,
 * points, subscription or payment. School-issued, Google, Telegram and
 * Facebook accounts are never touched.
 */
export async function findStaleUnverifiedStudentIds(): Promise<string[]> {
  const cutoff = new Date(Date.now() - UNVERIFIED_GRACE_DAYS * DAY_MS);

  const stale = await db.user.findMany({
    where: {
      role: "STUDENT",
      email: { not: null },
      emailVerifiedAt: null,
      createdAt: { lt: cutoff },
      googleId: null,
      telegramId: null,
      facebookId: null,
      schoolId: null,
      username: null,
      totalPoints: 0,
      lastActiveAt: null,
      sessions: { none: {} },
      quizzes: { none: {} },
      nationalExamAttempts: { none: {} },
      notes: { none: {} },
      savedGraphs: { none: {} },
      achievements: { none: {} },
      pointLedger: { none: {} },
      subscriptions: { none: {} },
      paymentRequests: { none: {} },
    },
    select: { id: true },
    take: 500,
  });

  return stale.map((u) => u.id);
}

/** Delete the accounts {@link findStaleUnverifiedStudentIds} returns. */
export async function deleteStaleUnverifiedStudents(): Promise<number> {
  const ids = await findStaleUnverifiedStudentIds();
  if (ids.length === 0) return 0;
  return deleteStudents(ids);
}
