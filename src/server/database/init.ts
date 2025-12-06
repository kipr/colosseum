import { getDatabase } from './connection';
import fs from 'fs';
import path from 'path';

const isProduction = process.env.NODE_ENV === 'production';
const usePostgres = isProduction || !!process.env.DATABASE_URL;

export async function initializeDatabase(): Promise<void> {
  const db = await getDatabase();

  if (!usePostgres) {
    // Ensure database directory exists for SQLite
    const dbDir = path.join(__dirname, '../../../database');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  if (usePostgres) {
    await initializePostgres(db);
  } else {
    await initializeSQLite(db);
  }

  console.log('✅ Database initialized successfully');
}

async function initializePostgres(db: any): Promise<void> {
  // PostgreSQL schema
  
  // Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at BIGINT,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Spreadsheet configurations
  await db.exec(`
    CREATE TABLE IF NOT EXISTS spreadsheet_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_name TEXT,
      sheet_name TEXT,
      sheet_purpose TEXT DEFAULT 'scores',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Scoresheet field templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_field_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      fields_json TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Scoresheet templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      access_code TEXT NOT NULL,
      spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Score submissions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      spreadsheet_config_id INTEGER NOT NULL REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
      participant_name TEXT,
      match_id TEXT,
      score_data TEXT NOT NULL,
      submitted_to_sheet BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Active sessions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS active_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      session_token TEXT UNIQUE NOT NULL,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Chat messages
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      spreadsheet_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Session store table for connect-pg-simple
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" VARCHAR NOT NULL COLLATE "default",
      "sess" JSON NOT NULL,
      "expire" TIMESTAMP(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    )
  `);
  
  await db.exec(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
  `);

  // Create indexes
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_spreadsheet_configs_user ON spreadsheet_configs(user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_spreadsheet ON chat_messages(spreadsheet_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`);
}

async function initializeSQLite(db: any): Promise<void> {
  // SQLite schema (existing schema)
  
  // Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      access_token TEXT,
      refresh_token TEXT,
      is_admin BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Spreadsheet configurations
  await db.exec(`
    CREATE TABLE IF NOT EXISTS spreadsheet_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_name TEXT,
      sheet_name TEXT,
      sheet_purpose TEXT,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Add sheet_purpose column if it doesn't exist
  try {
    await db.exec(`ALTER TABLE spreadsheet_configs ADD COLUMN sheet_purpose TEXT DEFAULT 'scores'`);
    console.log('✅ Added sheet_purpose column to spreadsheet_configs');
  } catch (error) {
    // Column already exists
  }

  // Add token_expires_at column to users table
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN token_expires_at INTEGER`);
    console.log('✅ Added token_expires_at column to users');
  } catch (error) {
    // Column already exists
  }

  // Scoresheet field templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_field_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      fields_json TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  
  // Migration: Remove type column if it exists
  try {
    const tableInfo = await db.all('PRAGMA table_info(scoresheet_field_templates)');
    const hasTypeColumn = tableInfo.some((col: any) => col.name === 'type');
    
    if (hasTypeColumn) {
      console.log('⚙️ Migrating scoresheet_field_templates to remove type column...');
      await db.exec(`
        CREATE TABLE scoresheet_field_templates_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          fields_json TEXT NOT NULL,
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO scoresheet_field_templates_new (id, name, description, fields_json, created_by, created_at, updated_at)
        SELECT id, name, description, fields_json, created_by, created_at, updated_at 
        FROM scoresheet_field_templates;
        DROP TABLE scoresheet_field_templates;
        ALTER TABLE scoresheet_field_templates_new RENAME TO scoresheet_field_templates;
      `);
      console.log('✅ Scoresheet field templates table migrated successfully');
    } else {
      console.log('✅ Scoresheet field templates table ready (no migration needed)');
    }
  } catch (error) {
    console.log('✅ Scoresheet field templates table ready');
  }

  // Scoresheet templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      access_code TEXT NOT NULL,
      created_by INTEGER,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Add access_code column if it doesn't exist
  try {
    await db.exec(`ALTER TABLE scoresheet_templates ADD COLUMN access_code TEXT`);
  } catch (error) {}

  // Add spreadsheet_config_id column if it doesn't exist
  try {
    await db.exec(`ALTER TABLE scoresheet_templates ADD COLUMN spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id)`);
    console.log('✅ Added spreadsheet_config_id column to scoresheet_templates');
  } catch (error) {}

  // Score submissions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      template_id INTEGER NOT NULL,
      spreadsheet_config_id INTEGER NOT NULL,
      participant_name TEXT,
      match_id TEXT,
      score_data TEXT NOT NULL,
      submitted_to_sheet BOOLEAN DEFAULT 0,
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (spreadsheet_config_id) REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Update score_submissions if needed
  try {
    const tableInfo = await db.all('PRAGMA table_info(score_submissions)');
    const hasStatus = tableInfo.some((col: any) => col.name === 'status');
    const hasReviewedBy = tableInfo.some((col: any) => col.name === 'reviewed_by');
    const userIdColumn = tableInfo.find((col: any) => col.name === 'user_id');
    
    if (!hasStatus || !hasReviewedBy || (userIdColumn && userIdColumn.notnull === 1)) {
      await db.exec(`
        CREATE TABLE score_submissions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          template_id INTEGER NOT NULL,
          spreadsheet_config_id INTEGER NOT NULL,
          participant_name TEXT,
          match_id TEXT,
          score_data TEXT NOT NULL,
          submitted_to_sheet BOOLEAN DEFAULT 0,
          status TEXT DEFAULT 'pending',
          reviewed_by INTEGER,
          reviewed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
          FOREIGN KEY (spreadsheet_config_id) REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO score_submissions_new (id, user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data, submitted_to_sheet, created_at, updated_at)
        SELECT id, user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data, submitted_to_sheet, created_at, updated_at FROM score_submissions;
        DROP TABLE score_submissions;
        ALTER TABLE score_submissions_new RENAME TO score_submissions;
      `);
      console.log('✅ Updated score_submissions table with review columns');
    }
  } catch (error) {}

  // Active sessions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS active_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE
    )
  `);

  // Chat messages
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spreadsheet_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT 0,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Create indexes
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_spreadsheet_configs_user ON spreadsheet_configs(user_id);
    CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_spreadsheet ON chat_messages(spreadsheet_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
  `);
}
