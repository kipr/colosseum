import type {
  ColumnAddition,
  SchemaDatabase,
  SchemaDialect,
  SchemaModule,
} from './types';

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
  dialect: SchemaDialect,
  addition: ColumnAddition,
): Promise<boolean> {
  if (dialect === 'postgres') {
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

  const existing = await db.get(
    `SELECT 1 AS present
     FROM pragma_table_info(?)
     WHERE name = ?`,
    [addition.table, addition.column],
  );
  return existing !== undefined;
}

async function addMissingColumns(
  db: SchemaExecutor,
  dialect: SchemaDialect,
  additions: readonly ColumnAddition[] = [],
): Promise<void> {
  for (const addition of additions) {
    if (await columnExists(db, dialect, addition)) continue;

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
    for (const module of modules) {
      await execStatements(tx, module[dialect].tables);
    }

    for (const module of modules) {
      await addMissingColumns(tx, dialect, module[dialect].columns);
    }

    for (const module of modules) {
      await execStatements(tx, module[dialect].constraints);
    }

    await createUpdatedAtTriggers(tx, dialect, collectUpdatedAtTables(modules));

    for (const module of modules) {
      await execStatements(tx, module[dialect].triggers);
    }

    for (const module of modules) {
      await execStatements(tx, module[dialect].indexes);
    }
  });
}
