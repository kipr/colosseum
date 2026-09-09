/**
 * Classification of PostgreSQL integrity constraint violations.
 *
 * Matching on message text only used to miss Postgres errors (every
 * constraint violation fell through to a 500), so these helpers key off
 * SQLSTATE class 23 first and keep the Postgres message as a fallback.
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
  return (
    errorCode(error) === PG_UNIQUE_VIOLATION ||
    errorMessage(error).includes(
      'duplicate key value violates unique constraint',
    )
  );
}

export function isForeignKeyConstraintError(error: unknown): boolean {
  return (
    errorCode(error) === PG_FOREIGN_KEY_VIOLATION ||
    errorMessage(error).includes('violates foreign key constraint')
  );
}

export function isCheckConstraintError(error: unknown): boolean {
  return (
    errorCode(error) === PG_CHECK_VIOLATION ||
    errorMessage(error).includes('violates check constraint')
  );
}

export function isNotNullConstraintError(error: unknown): boolean {
  return (
    errorCode(error) === PG_NOT_NULL_VIOLATION ||
    errorMessage(error).includes('violates not-null constraint')
  );
}
