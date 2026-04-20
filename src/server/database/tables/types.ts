/**
 * Shape of a per-table baseline definition. Each table module exports an
 * object conforming to this interface with both dialects colocated.
 *
 * The `pg` and `sqlite` strings are full `CREATE TABLE IF NOT EXISTS` bodies
 * lifted verbatim from the original `init.ts`. They are intentionally not
 * parsed; the runner just `db.exec()`s them in `TABLES_IN_ORDER`.
 */
export interface TableDefinition {
  /** Snake-case table name. Must match the `CREATE TABLE` body exactly. */
  name: string;
  /** Postgres `CREATE TABLE IF NOT EXISTS ...` statement. */
  pg: string;
  /** SQLite `CREATE TABLE IF NOT EXISTS ...` statement. */
  sqlite: string;
}
