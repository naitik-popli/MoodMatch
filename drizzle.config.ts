import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL_LOCAL) {
  throw new Error("DATABASE_URL_LOCAL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./server/migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_LOCAL,
  },
});
