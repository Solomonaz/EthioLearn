import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Enabling pgvector...");
  await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  console.log("Done.");
}

main().catch(console.error).finally(() => db.$disconnect());
