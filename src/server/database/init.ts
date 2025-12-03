import { getDatabase } from './connection';
import fs from 'fs';
import path from 'path';

export async function initializeDatabase(): Promise<void> {
  const db = await getDatabase();

  // Ensure database directory exists
  const dbDir = path.join(__dirname, '../../../database');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

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
      sheet_purpose TEXT, -- 'data', 'scores', or other custom purposes
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

  // Scoresheet templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL, -- JSON schema defining fields
      access_code TEXT NOT NULL, -- Code required for judges to access
      created_by INTEGER,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Add access_code column if it doesn't exist (for existing databases)
  try {
    await db.exec(`ALTER TABLE scoresheet_templates ADD COLUMN access_code TEXT`);
  } catch (error) {
    // Column already exists, ignore error
  }

  // Add spreadsheet_config_id column if it doesn't exist (links template to primary spreadsheet)
  try {
    await db.exec(`ALTER TABLE scoresheet_templates ADD COLUMN spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id)`);
    console.log('✅ Added spreadsheet_config_id column to scoresheet_templates');
  } catch (error) {
    // Column already exists, ignore error
  }

  // Score submissions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, -- NULL allowed for judge submissions
      template_id INTEGER NOT NULL,
      spreadsheet_config_id INTEGER NOT NULL,
      participant_name TEXT,
      match_id TEXT,
      score_data TEXT NOT NULL, -- JSON data containing all field values
      submitted_to_sheet BOOLEAN DEFAULT 0,
      status TEXT DEFAULT 'pending', -- pending, accepted, rejected
      reviewed_by INTEGER, -- Admin who reviewed
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (spreadsheet_config_id) REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Add new columns to existing table if needed
  try {
    const tableInfo = await db.all('PRAGMA table_info(score_submissions)');
    const hasStatus = tableInfo.some((col: any) => col.name === 'status');
    const hasReviewedBy = tableInfo.some((col: any) => col.name === 'reviewed_by');
    const userIdColumn = tableInfo.find((col: any) => col.name === 'user_id');
    
    // If table needs updating
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
  } catch (error) {
    // Table might not exist yet, ignore error
  }

  // Active sessions (for tracking who's using which scoresheet)
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

  // Create indexes for better performance
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_spreadsheet_configs_user ON spreadsheet_configs(user_id);
    CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
  `);

  console.log('✅ Database initialized successfully');
}

