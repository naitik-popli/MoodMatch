import pg from 'pg';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL_TEST) {
  throw new Error(
    "DATABASE_URL_TEST must be set. Did you forget to provision a database?",
  );
}

const { Pool } = pg;

function createPoolWithRetry(maxRetries: number, delayMs: number): pg.Pool {
  let retries = 0;
  let pool: pg.Pool | null = null;

  const createPool = (): pg.Pool => {
    return new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      ssl: { rejectUnauthorized: false },
    });
  };

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const tryCreatePool = async (): Promise<pg.Pool> => {
    while (retries < maxRetries) {
      try {
        const p = createPool();
        // Test connection
        await p.query('SELECT 1');
        return p;
      } catch (err) {
        retries++;
        console.error(`Failed to connect to DB (attempt ${retries}):`, err);
        await wait(delayMs);
      }
    }
    throw new Error('Exceeded max retries to connect to DB');
  };

  // Return a proxy pool that delays actual creation until first query
  const proxyPool = new Proxy({} as pg.Pool, {
    get(target, prop) {
      if (!pool) {
        throw new Error('Pool not initialized yet');
      }
      // @ts-ignore
      return pool[prop];
    },
    set(target, prop, value) {
      if (!pool) {
        throw new Error('Pool not initialized yet');
      }
      // @ts-ignore
      pool[prop] = value;
      return true;
    }
  });

  tryCreatePool().then(p => {
    pool = p;
    console.log('Database pool connected successfully');
  }).catch(err => {
    console.error('Failed to establish database pool:', err);
  });

  return proxyPool;
}

// Use pg Pool with retry logic for PostgreSQL connection
export const pool = createPoolWithRetry(5, 2000);

// Use drizzle-orm with postgres-js client for local PostgreSQL
const sql = postgres(process.env.DATABASE_URL_TEST, { max: 1, ssl: true });
export const db = drizzle(sql, { schema });

export const moodQueue = schema.moodQueue;
