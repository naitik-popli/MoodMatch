import { defineConfig } from "drizzle-kit";
import { parse } from 'pg-connection-string';

// Parse the connection URL to handle SSL properly
const connectionOptions = parse(process.env.DATABASE_URL_TEST || '');

if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is missing - ensure the database is provisioned");
}

export default defineConfig({
  out: "./server/migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: `${process.env.DATABASE_URL_TEST}?sslmode=require`,
    ssl: {
      rejectUnauthorized: false // Needed for Render's PostgreSQL
    },
  },
  verbose: true, // For debugging
  strict: true,
});