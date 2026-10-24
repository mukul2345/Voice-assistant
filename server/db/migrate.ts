import { sql } from "drizzle-orm";
import { db, sqlite } from './index';
import { logger } from '../logging/SafeLogger';

/**
 * Run database migrations.
 * Creates all tables if they don't exist.
 * This is a simple "create if not exists" approach for SQLite.
 * For production with schema evolution, use drizzle-kit generate + migrate.
 */
export function runMigrations() {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS trial_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      used_seconds REAL DEFAULT 0,
      total_allowed_seconds REAL DEFAULT 3600,
      last_updated TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'inactive',
      plan TEXT DEFAULT 'monthly',
      current_period_end TEXT,
      grace_period_end TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      company_name TEXT DEFAULT '',
      job_description TEXT DEFAULT '',
      resume_text TEXT DEFAULT '',
      skills_json TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'CREATED',
      failure_code TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const sessionColumns = sqlite.pragma('table_info(sessions)') as ReadonlyArray<{ name: string }>;
  if (!sessionColumns.some(({ name }) => name === 'status')) {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'CREATED'");
  }
  if (!sessionColumns.some(({ name }) => name === 'failure_code')) {
    sqlite.exec('ALTER TABLE sessions ADD COLUMN failure_code TEXT');
  }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES sessions(id),
      user_id INTEGER REFERENCES users(id),
      transcription TEXT NOT NULL,
      ai_response TEXT NOT NULL,
      interview_type TEXT DEFAULT 'general',
      audio_duration_seconds REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  logger.info('Database migrations completed.');
}
