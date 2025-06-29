import pg from 'pg';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL_TEST_INTERNAL || !process.env.DATABASE_URL_TEST_EXTERNAL) {
  throw new Error(
    "DATABASE_URL_TEST_INTERNAL and DATABASE_URL_TEST_EXTERNAL must be set. Did you forget to provision a database?",
  );
}

const { Pool } = pg;

async function createPoolWithFallback() {
  // Try internal URL first
  let pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST_INTERNAL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query('SELECT 1');
    console.log('Connected to database using internal URL');
    return pool;
  } catch (err) {
    console.warn('Failed to connect using internal URL, trying external URL...');
    await pool.end();
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST_EXTERNAL, ssl: { rejectUnauthorized: false } });
    await pool.query('SELECT 1');
    console.log('Connected to database using external URL');
    return pool;
  }
}

export let pool: pg.Pool;

(async () => {
  pool = await createPoolWithFallback();
})();

// Use drizzle-orm with postgres-js client for local PostgreSQL
// For drizzle, we will just use the external URL with ssl enabled
const sql = postgres(process.env.DATABASE_URL_TEST_EXTERNAL, { max: 1, ssl: true });
export const db = drizzle(sql, { schema });

export const moodQueue = schema.moodQueue;
