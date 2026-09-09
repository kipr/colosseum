/**
 * Dialect-aware classification of constraint violations.
 *
 * SQLite and PostgreSQL report the same violation with different SQLSTATE
 * codes and different messages, so routes cannot match on either alone.
 * Matching on the message text only, as the routes used to, meant every
 * constraint violation on PostgreSQL fell through to a 500.
 */

/** PostgreSQL SQLSTATE class 23 - integrity constraint violation. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_NOT_NULL_VIOLATION = '23502';
const PG_CHECK_VIOLATION = '23514';

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

export function isUniqueConstraintError(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === PG_UNIQUE_VIOLATION ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    errorMessage(error).includes('UNIQUE constraint failed') ||
    errorMessage(error).includes('duplicate key value violates unique constraint')
  );
}

export function isForeignKeyConstraintError(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === PG_FOREIGN_KEY_VIOLATION ||
    code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
    errorMessage(error).includes('FOREIGN KEY constraint failed') ||
    errorMessage(error).includes('violates foreign key constraint')
  );
}

export function isCheckConstraintError(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === PG_CHECK_VIOLATION ||
    code === 'SQLITE_CONSTRAINT_CHECK' ||
    errorMessage(error).includes('CHECK constraint failed') ||
    errorMessage(error).includes('violates check constraint')
  );
}

export function isNotNullConstraintError(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === PG_NOT_NULL_VIOLATION ||
    code === 'SQLITE_CONSTRAINT_NOTNULL' ||
    errorMessage(error).includes('NOT NULL constraint failed') ||
    errorMessage(error).includes('violates not-null constraint')
  );
}
