import type {
  SchemaDatabase,
  SchemaDialect,
  SchemaModule,
  SchemaPhase,
} from './types';

type SchemaExecutor = Pick<SchemaDatabase, 'exec'>;

const tablePhases = [
  'tables',
  'constraints',
] as const satisfies readonly SchemaPhase[];
const postTablePhases = [
  'triggers',
  'indexes',
] as const satisfies readonly SchemaPhase[];

async function execStatements(
  db: SchemaExecutor,
  statements: readonly string[] = [],
): Promise<void> {
  for (const statement of statements) {
    await db.exec(statement);
  }
}

function collectUpdatedAtTables(modules: readonly SchemaModule[]): string[] {
  return Array.from(
    new Set(modules.flatMap((module) => module.updatedAtTables ?? [])),
  );
}

async function createUpdatedAtTriggers(
  db: SchemaExecutor,
  dialect: SchemaDialect,
  tables: readonly string[],
): Promise<void> {
  if (tables.length === 0) return;

  if (dialect === 'postgres') {
    await db.exec(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.updated_at = OLD.updated_at THEN
          NEW.updated_at = CURRENT_TIMESTAMP;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    for (const table of tables) {
      await db.exec(`
        DROP TRIGGER IF EXISTS ${table}_updated_at ON ${table};
        CREATE TRIGGER ${table}_updated_at
          BEFORE UPDATE ON ${table}
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column()
      `);
    }

    return;
  }

  for (const table of tables) {
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${table}_updated_at
      AFTER UPDATE ON ${table}
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE ${table}
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
      END
    `);
  }
}

export async function runSchema(
  db: SchemaDatabase,
  dialect: SchemaDialect,
  modules: readonly SchemaModule[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const phase of tablePhases) {
      for (const module of modules) {
        await execStatements(tx, module[dialect][phase]);
      }
    }

    await createUpdatedAtTriggers(tx, dialect, collectUpdatedAtTables(modules));

    for (const phase of postTablePhases) {
      for (const module of modules) {
        await execStatements(tx, module[dialect][phase]);
      }
    }
  });
}
