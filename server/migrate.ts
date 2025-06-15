import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
  });

  try {
    const client = await pool.connect();

    const migrationFilePath = path.resolve(__dirname, '../migrations/0000_gray_nova.sql');
    const migrationSql = fs.readFileSync(migrationFilePath, 'utf-8');

    // Split the migration SQL by the statement-breakpoint comment
    const statements = migrationSql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

    for (const statement of statements) {
      console.log('Running migration statement...');
      await client.query(statement);
    }

    console.log('Migrations completed successfully.');
    client.release();
    process.exit(0);
  } catch (error) {
    console.error('Error running migrations:', error);
    process.exit(1);
  }
}

runMigrations();
