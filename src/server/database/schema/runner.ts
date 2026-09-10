import type { ColumnAddition, SchemaDatabase, SchemaModule } from './types';

type SchemaExecutor = Pick<SchemaDatabase, 'exec' | 'get'>;

async function execStatements(
  db: SchemaExecutor,
  statements: readonly string[] = [],
): Promise<void> {
  for (const statement of statements) {
    await db.exec(statement);
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function columnExists(
  db: SchemaExecutor,
  addition: ColumnAddition,
): Promise<boolean> {
  const existing = await db.get(
    `SELECT 1 AS present
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = ?
       AND column_name = ?`,
    [addition.table, addition.column],
  );
  return existing !== undefined;
}

async function addMissingColumns(
  db: SchemaExecutor,
  additions: readonly ColumnAddition[] = [],
): Promise<void> {
  for (const addition of additions) {
    if (await columnExists(db, addition)) continue;

    await db.exec(
      `ALTER TABLE ${quoteIdentifier(addition.table)} ADD COLUMN ${quoteIdentifier(addition.column)} ${addition.definition}`,
    );
  }
}

function collectUpdatedAtTables(modules: readonly SchemaModule[]): string[] {
  return Array.from(
    new Set(modules.flatMap((module) => module.updatedAtTables ?? [])),
  );
}

async function createUpdatedAtTriggers(
  db: SchemaExecutor,
  tables: readonly string[],
): Promise<void> {
  if (tables.length === 0) return;

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
}

export async function runSchema(
  db: SchemaDatabase,
  modules: readonly SchemaModule[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const module of modules) {
      await execStatements(tx, module.tables);
    }

    for (const module of modules) {
      await addMissingColumns(tx, module.columns);
    }

    for (const module of modules) {
      await execStatements(tx, module.constraints);
    }

    await createUpdatedAtTriggers(tx, collectUpdatedAtTables(modules));

    for (const module of modules) {
      await execStatements(tx, module.triggers);
    }

    for (const module of modules) {
      await execStatements(tx, module.indexes);
    }
  });
}
