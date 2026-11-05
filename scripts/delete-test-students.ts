/**
 * Permanently delete test STUDENT accounts and everything they own.
 *
 *   npx tsx scripts/delete-test-students.ts <identifier>... [--apply]
 *
 * An identifier is an email, username or Telegram id. Without --apply it only
 * prints what would be deleted (dry run). Refuses anything that is not a
 * STUDENT, and refuses an identifier that matches nothing. The deletion is
 * lib/delete-student (same code as the admin Delete button): all or nothing.
 */
import { db } from "../src/lib/db";
import { deleteStudents } from "../src/lib/delete-student";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const idents = args.filter((a) => a !== "--apply").map((a) => a.trim()).filter(Boolean);
  if (idents.length === 0) {
    console.error("Usage: npx tsx scripts/delete-test-students.ts <email|username|telegramId>... [--apply]");
    process.exit(1);
  }

  const users = [];
  for (const ident of idents) {
    const u = await db.user.findFirst({
      where: { OR: [{ email: ident.toLowerCase() }, { username: ident }, { telegramId: ident }] },
      select: { id: true, name: true, email: true, username: true, telegramId: true, role: true, schoolId: true, grade: true, createdAt: true },
    });
    if (!u) throw new Error(`No user matches "${ident}" — nothing deleted.`);
    if (u.role !== "STUDENT") throw new Error(`"${ident}" is a ${u.role}, not a STUDENT — nothing deleted.`);
    users.push(u);
  }
  const ids = [...new Set(users.map((u) => u.id))];

  const hostedRooms = await db.gameRoom.findMany({ where: { hostUserId: { in: ids } }, select: { id: true } });
  const roomIds = hostedRooms.map((r) => r.id);
  const counts = {
    quizzes: await db.quiz.count({ where: { studentId: { in: ids } } }),
    gamePlayers: await db.gamePlayer.count({ where: { userId: { in: ids } } }),
    hostedGameRooms: roomIds.length,
    otherPlayersQuizzesInThoseRooms: await db.quiz.count({ where: { gameRoomId: { in: roomIds }, studentId: { notIn: ids } } }),
    redemptions: await db.redemption.count({ where: { studentId: { in: ids } } }),
    pointLedger: await db.pointLedger.count({ where: { userId: { in: ids } } }),
    notifications: await db.notification.count({ where: { userId: { in: ids } } }),
    subscriptions: await db.subscription.count({ where: { studentId: { in: ids } } }),
    paymentRequests: await db.paymentRequest.count({ where: { studentId: { in: ids } } }),
    nationalExamAttempts: await db.nationalExamAttempt.count({ where: { studentId: { in: ids } } }),
  };

  console.log(`\n${apply ? "DELETING" : "DRY RUN — would delete"} ${ids.length} student(s):`);
  for (const u of users) {
    console.log(`  - ${u.name} | ${u.email ?? u.username ?? `telegram ${u.telegramId}`} | grade ${u.grade ?? "-"} | school ${u.schoolId ?? "none"} | joined ${u.createdAt.toISOString().slice(0, 10)}`);
  }
  console.log("Related records:", counts);

  if (!apply) {
    console.log("\nNothing deleted. Re-run with --apply to delete.");
    return;
  }

  await deleteStudents(ids);
  console.log(`\nDeleted ${ids.length} student(s) and their records.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
