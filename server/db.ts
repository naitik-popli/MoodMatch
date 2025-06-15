import pg from 'pg';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const { Pool } = pg;

// Use pg Pool for local PostgreSQL connection
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Use drizzle-orm with postgres-js client for local PostgreSQL
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
export const db = drizzle(sql, { schema });
