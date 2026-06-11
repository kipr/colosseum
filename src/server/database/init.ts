import fs from 'fs';
import path from 'path';
import { getDatabase, type Database } from './connection';
import { runSchema, schemaModules } from './schema';

const isProduction = process.env.NODE_ENV === 'production';
const usePostgres = isProduction || !!process.env.DATABASE_URL;

export async function initializeDatabase(): Promise<void> {
  const db = await getDatabase();

  if (!usePostgres) {
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

  console.log('Database initialized successfully');
}

export async function initializePostgres(db: Database): Promise<void> {
  await runSchema(db, 'postgres', schemaModules);
}

/**
 * Initialize SQLite schema. Exported for use by tests with in-memory databases.
 */
export async function initializeSQLite(db: Database): Promise<void> {
  await runSchema(db, 'sqlite', schemaModules);
}
