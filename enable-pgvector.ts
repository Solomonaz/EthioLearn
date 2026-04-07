import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  console.log("Enabling pgvector...");
  await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  console.log("Done.");
}

main().catch(console.error).finally(() => db.$disconnect());
