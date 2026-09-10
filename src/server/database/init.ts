import { getDatabase, type Database } from './connection';
import { runSchema, schemaModules } from './schema';
import { backfillBracketGamePlayOrders } from '../services/bracketTemplates';

export async function initializeDatabase(): Promise<void> {
  const db = await getDatabase();
  await initializePostgres(db);
  console.log('Database initialized successfully');
}

export async function initializePostgres(db: Database): Promise<void> {
  await runSchema(db, schemaModules);
  await backfillBracketGamePlayOrders(db);
}
