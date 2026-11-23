import { PrismaClient } from '@prisma/client';
import { seedSampleData } from '../apps/api/src/seed/sample-data';

/** Empties the test database and loads the sample formulary, like the API e2e tests. */
export default async function globalSetup() {
  const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await seedSampleData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
