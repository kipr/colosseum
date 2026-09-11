import type { Database } from '../connection';

/** A source-controlled, additive migration for one database column. */
export interface ColumnAddition {
  /** Unqualified table name in the dialect's current schema. */
  table: string;
  /** Column identifier to check and add. */
  column: string;
  /** Trusted DDL fragment after the column name, including type/defaults. */
  definition: string;
}

/** A source-controlled, idempotent removal for one obsolete database column. */
export interface ColumnRemoval {
  /** Unqualified table name in the dialect's current schema. */
  table: string;
  /** Column identifier to drop when present. */
  column: string;
}

export interface DialectSchema {
  tables?: readonly string[];
  columns?: readonly ColumnAddition[];
  columnRemovals?: readonly ColumnRemoval[];
  constraints?: readonly string[];
  triggers?: readonly string[];
  indexes?: readonly string[];
}

export interface SchemaModule extends DialectSchema {
  name: string;
  updatedAtTables?: readonly string[];
}

export type SchemaPhase = keyof DialectSchema;

export type SchemaDatabase = Database;
