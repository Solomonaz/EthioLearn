/**
 * One-off: deactivate grades 1-8 teachers who have no school.
 *
 * Elementary teachers used to sign themselves up with no school. They now get
 * access only through their school's subscription, and their school admin
 * creates them. The accounts left over from self-registration are
 * deactivated rather than attached or grandfathered (product decision,
 * 2026-09-28). Their saved game sets stay in the database; a school admin who
 * wants one of them back creates the teacher again, or a super admin
 * reactivates the account from Admin → Teachers after it has a school.
 *
 * Dry run:  npx tsx --env-file=.env scripts/deactivate-unschooled-elementary-teachers.ts
 * Apply:    npx tsx --env-file=.env scripts/deactivate-unschooled-elementary-teachers.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const apply = process.argv.includes("--apply");

  const teachers = await prisma.user.findMany({
    where: { role: "TEACHER", schoolId: null, isActive: true },
    select: { id: true, name: true, phoneNumber: true, _count: { select: { gameContents: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (teachers.length === 0) {
    console.log("No active grades 1-8 teachers without a school. Nothing to do.");
    return;
  }

  console.log(`Found ${teachers.length} active grades 1-8 teacher(s) with no school:\n`);
  for (const t of teachers) {
    console.log(`  ${t.name}  ${t.phoneNumber ?? "(no phone)"}  · ${t._count.gameContents} game set(s)`);
  }

  if (!apply) {
    console.log("\nDry run — nothing changed. Re-run with --apply to deactivate them.");
    return;
  }

  // Same flags the admin "Deactivate" button sets: getCurrentUser() treats a
  // suspended account as signed out.
  const result = await prisma.user.updateMany({
    where: { id: { in: teachers.map((t) => t.id) } },
    data: {
      isActive: false,
      suspendedAt: new Date(),
      suspendReason: "Teachers now join through their school — ask your school admin to add you",
    },
  });
  console.log(`\nDeactivated ${result.count} teacher(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
