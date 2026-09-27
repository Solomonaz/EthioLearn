/**
 * One-off repair: re-price subscriptions that were stored with no amount.
 *
 * These come from plans whose brackets didn't cover the target's student count
 * (e.g. a school with 0 students on a plan whose first bracket starts at 1),
 * which used to save `amount: null` and render as "—/month". The assignment
 * route now refuses to create those, and computePlanPrice falls back to the
 * nearest bracket — this fixes the rows written before both changes.
 *
 * Dry run:  npx tsx scripts/reprice-subscriptions.ts
 * Apply:    npx tsx scripts/reprice-subscriptions.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computePlanPrice, formatMoney } from "../src/lib/pricing";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const apply = process.argv.includes("--apply");

  // Live subscriptions only. An expired row's amount is an audit snapshot of
  // what was charged back then — re-pricing it at today's student count would
  // invent a number that was never true, and nothing displays it anyway.
  const broken = await prisma.subscription.findMany({
    where: { amount: null, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    include: { plan: { include: { tiers: true } }, school: { select: { name: true } } },
  });

  if (broken.length === 0) {
    console.log("No subscriptions with a missing price. Nothing to do.");
    return;
  }

  console.log(`Found ${broken.length} subscription(s) with no price:\n`);

  for (const sub of broken) {
    // Re-count live rather than trusting the old snapshot: it was taken at
    // assignment time and the school may have enrolled students since.
    const studentCount = sub.schoolId
      ? await prisma.user.count({ where: { schoolId: sub.schoolId, role: "STUDENT" } })
      : 0;
    const teacherCount = sub.schoolId
      ? await prisma.user.count({
          where: { schoolId: sub.schoolId, role: "SECONDARY_TEACHER", isActive: true },
        })
      : 0;

    const priced = computePlanPrice(sub.plan, studentCount, teacherCount);

    const who = sub.school?.name ?? `student ${sub.studentId}`;
    if (priced.amount === null) {
      console.log(`  ✗ ${who} — "${sub.plan.name}": still unpriceable (${priced.note}). Fix the plan's brackets.`);
      continue;
    }

    console.log(
      `  ${apply ? "✓" : "→"} ${who} — "${sub.plan.name}": ` +
        `${formatMoney(priced.amount, sub.currency)} (${studentCount} students)` +
        (priced.note ? ` — ${priced.note}` : "")
    );

    if (apply) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          amount: priced.amount,
          studentCountSnapshot: sub.schoolId ? studentCount : null,
          teacherCountSnapshot: sub.schoolId ? teacherCount : null,
        },
      });
    }
  }

  console.log(apply ? "\nDone." : "\nDry run — re-run with --apply to write these changes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
