import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_TEST,
  },
});
