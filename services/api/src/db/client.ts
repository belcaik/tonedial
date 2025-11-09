import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import { env } from '../env.js';

const pool = new Pool({ connectionString: env.databaseUrl });

export const db = drizzle(pool, { schema });
export { schema };

export async function closeDb() {
  await pool.end();
}
