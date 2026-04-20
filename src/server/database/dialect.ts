/**
 * Small helpers for the two database dialects we support.
 *
 * Centralises the `Dialect` type and runtime detection so the rest of the
 * database layer doesn't have to repeat the `usePostgres` check.
 */
export type Dialect = 'pg' | 'sqlite';

const isProduction = process.env.NODE_ENV === 'production';
const usePostgres = isProduction || !!process.env.DATABASE_URL;

export function currentDialect(): Dialect {
  return usePostgres ? 'pg' : 'sqlite';
}
