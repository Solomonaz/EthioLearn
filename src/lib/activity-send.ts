import { db } from "./db";
import { createNotification } from "./notifications";

/**
 * Sending work to a class, and taking it back.
 *
 * Sending is where a class is notified. Taking back exists because teachers
 * send the wrong thing — to the wrong class, or before they meant to — and
 * the only other way out was to close it, which leaves it on every student's
 * list. It is allowed only while no student has done anything with the work:
 * once someone has started, answered or handed in, it is theirs, and closing
 * is the way to stop it.
 */

/** Mark an activity sent and notify every student it was set for. */
export async function publishActivity(activity: {
  id: string;
  kind: string;
  title: string;
  subject: string;
}): Promise<{ publishedAt: Date; notified: number }> {
  const publishedAt = new Date();
  await db.classActivity.update({
    where: { id: activity.id },
    data: { status: "PUBLISHED", publishedAt },
  });

  const targets = await db.classActivityTarget.findMany({
    where: { activityId: activity.id },
    select: { studentId: true },
  });

  // Best-effort: a notification failure must not undo a published activity.
  // The work is visible either way — the notice is a convenience.
  await Promise.allSettled(
    targets.map((t) =>
      createNotification(
        t.studentId,
        "homework",
        activity.title,
        `New ${activity.kind.toLowerCase()} from your ${activity.subject} teacher.`,
        { activityId: activity.id },
      ),
    ),
  );

  return { publishedAt, notified: targets.length };
}

export type TakeBackResult =
  | { ok: true; outcome: "deleted" | "draft" }
  | { ok: false; status: number; error: string };

/**
 * Take work back from a class.
 *
 * `toDraft` returns sent work to a draft (the teacher sent a reviewed draft too
 * early and wants it back to fix); otherwise it is deleted outright. A draft is
 * always deletable — nothing has reached anyone.
 */
export async function takeBackActivity(
  teacherId: string,
  activityId: string,
  { toDraft = false }: { toDraft?: boolean } = {},
): Promise<TakeBackResult> {
  const activity = await db.classActivity.findFirst({
    where: { id: activityId, teacherId },
    select: { id: true, status: true },
  });
  if (!activity) return { ok: false, status: 404, error: "Activity not found" };

  if (activity.status === "DRAFT") {
    if (toDraft) return { ok: false, status: 409, error: "That has not been sent yet." };
    // Targets and pinned questions cascade. Generated Question rows stay in
    // the bank on purpose — they were verified and paid for.
    await db.classActivity.delete({ where: { id: activity.id } });
    return { ok: true, outcome: "deleted" };
  }

  // Anything a student did makes the work theirs.
  const [startedTargets, attempts] = await Promise.all([
    db.classActivityTarget.count({
      where: {
        activityId: activity.id,
        OR: [
          { completedAt: { not: null } },
          { submittedAt: { not: null } },
          { markedAt: { not: null } },
          { files: { some: {} } },
        ],
      },
    }),
    db.quiz.count({ where: { activityId: activity.id } }),
  ]);
  const started = Math.max(startedTargets, attempts);
  if (started > 0) {
    return {
      ok: false,
      status: 409,
      error: `${started} student${started === 1 ? " has" : "s have"} already started this, so it can't be taken back. Close it instead.`,
    };
  }

  // The notices go too — one pointing at work that no longer exists is worse
  // than none.
  await db.notification.deleteMany({
    where: { type: "homework", data: { path: ["activityId"], equals: activity.id } },
  });

  if (toDraft) {
    await db.classActivity.update({
      where: { id: activity.id },
      data: { status: "DRAFT", publishedAt: null },
    });
    return { ok: true, outcome: "draft" };
  }
  await db.classActivity.delete({ where: { id: activity.id } });
  return { ok: true, outcome: "deleted" };
}
