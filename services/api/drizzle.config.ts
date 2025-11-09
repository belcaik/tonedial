import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      `postgresql://${process.env.PGUSER ?? 'postgres'}:${process.env.PGPASSWORD ?? 'postgres'}@${process.env.PGHOST ?? 'localhost'}:${process.env.PGPORT ?? '5432'}/${process.env.PGDATABASE ?? 'tonedial'}`,
  },
});
