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

export interface DialectSchema {
  tables?: readonly string[];
  columns?: readonly ColumnAddition[];
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
