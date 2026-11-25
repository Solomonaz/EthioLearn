/**
 * One-off repair: put a cost on read-aloud (TTS) usage logged before voices
 * had prices (lib/model-pricing). Those rows show as "unpriced" in
 * Admin → AI usage.
 *
 * Dry run:  npx tsx scripts/reprice-tts-usage.ts
 * Apply:    npx tsx scripts/reprice-tts-usage.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { costUsd } from "../src/lib/model-pricing";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.usageEvent.findMany({
    where: { feature: "tts", unpriced: true },
    select: { id: true, model: true, promptTokens: true, totalTokens: true },
  });
  let fixed = 0;
  let total = 0;
  for (const r of rows) {
    const cost = costUsd(r.model, r.promptTokens, r.totalTokens);
    if (cost === null) continue;
    fixed++;
    total += cost;
    if (apply) await prisma.usageEvent.update({ where: { id: r.id }, data: { costUsd: cost, unpriced: false } });
  }
  console.log(`${rows.length} unpriced voice rows; ${fixed} can be priced, $${total.toFixed(4)} in all.`);
  console.log(apply ? "Applied." : "Dry run — add --apply to save.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
