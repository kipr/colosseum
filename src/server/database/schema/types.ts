import type { Database } from '../connection';

export type SchemaDialect = 'postgres' | 'sqlite';

export interface DialectSchema {
  tables?: readonly string[];
  constraints?: readonly string[];
  triggers?: readonly string[];
  indexes?: readonly string[];
}

export interface SchemaModule {
  name: string;
  updatedAtTables?: readonly string[];
  postgres: DialectSchema;
  sqlite: DialectSchema;
}

export type SchemaPhase = keyof DialectSchema;

export type SchemaDatabase = Database;
