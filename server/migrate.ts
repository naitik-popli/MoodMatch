import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

// Initialize environment variables
dotenv.config();

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER || 'moodmatchuser',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'moodmatchdb',
  password: process.env.DB_PASSWORD || 'moodmatchpass',
  port: Number(process.env.DB_PORT) || 5432,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting database migration...');
    
    await client.query('BEGIN');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Create connections table
    await client.query(`
      CREATE TABLE IF NOT EXISTS connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        mood VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        peer_id TEXT,
        ice_candidates JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_status CHECK (status IN ('active', 'disconnected', 'matched'))
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_connections_mood_status
      ON connections(mood, status)
      WHERE status = 'active';
    `);

    await client.query('COMMIT');
    console.log('✅ Migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Modern Node.js top-level await
await runMigration();