import { db } from "./db";

/**
 * Permanently delete STUDENT accounts and everything they own, in one
 * transaction (all or nothing). Several relations to User have no ON DELETE
 * CASCADE, so those rows go first; the rest cascade with the user.
 * Throws — and deletes nothing — if any id is not a student.
 */
export async function deleteStudents(ids: string[]): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;

  return db.$transaction(async (tx) => {
    const found = await tx.user.count({ where: { id: { in: unique }, role: "STUDENT" } });
    if (found !== unique.length) throw new Error("Only student accounts can be deleted.");

    // Rooms these students hosted: detach other players' quizzes and tournament
    // rounds (kept), then the rooms go (their GamePlayer rows cascade).
    const rooms = await tx.gameRoom.findMany({ where: { hostUserId: { in: unique } }, select: { id: true } });
    const roomIds = rooms.map((r) => r.id);
    if (roomIds.length) {
      await tx.quiz.updateMany({ where: { gameRoomId: { in: roomIds }, studentId: { notIn: unique } }, data: { gameRoomId: null } });
      await tx.tournamentRound.updateMany({ where: { gameRoomId: { in: roomIds } }, data: { gameRoomId: null } });
    }
    // Relations without ON DELETE CASCADE.
    await tx.quiz.deleteMany({ where: { studentId: { in: unique } } }); // QuizAnswer cascades
    await tx.gamePlayer.deleteMany({ where: { userId: { in: unique } } });
    if (roomIds.length) await tx.gameRoom.deleteMany({ where: { id: { in: roomIds } } });
    await tx.redemption.deleteMany({ where: { studentId: { in: unique } } });
    await tx.pointLedger.deleteMany({ where: { userId: { in: unique } } });
    await tx.notification.deleteMany({ where: { userId: { in: unique } } });
    // Optional "done by" links a student would not normally hold — cleared, not deleted.
    await tx.redemption.updateMany({ where: { approvedById: { in: unique } }, data: { approvedById: null } });
    await tx.classActivityTarget.updateMany({ where: { markedById: { in: unique } }, data: { markedById: null } });
    await tx.subscription.updateMany({ where: { createdById: { in: unique } }, data: { createdById: null } });
    await tx.paymentRequest.updateMany({ where: { reviewedById: { in: unique } }, data: { reviewedById: null } });
    // Per-user rows with no foreign key.
    await tx.tutorDailyUse.deleteMany({ where: { userId: { in: unique } } });
    // The users; sessions, notes, subscriptions, payments, exam attempts,
    // achievements, saved graphs, activity targets and submissions cascade.
    const res = await tx.user.deleteMany({ where: { id: { in: unique }, role: "STUDENT" } });
    if (res.count !== unique.length) throw new Error("Could not delete every account — nothing was deleted.");
    return res.count;
  });
}
