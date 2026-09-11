/** Read-only pre-rollout audit; never imports server initialization or migrations. */
import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { Client } from 'pg';
import { compileScoresheetFormulas } from '../src/shared/scoresheetFormulaProgram';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function fieldsOf(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (!object(value))
    throw new Error('Expected a schema object or field array.');
  return object(value.schema) ? value.schema.fields : value.fields;
}
let checked = 0;
let invalid = 0;
function audit(label: string, json: string) {
  checked++;
  try {
    const result = compileScoresheetFormulas(fieldsOf(JSON.parse(json)));
    if (!result.ok) {
      invalid++;
      console.log(JSON.stringify({ source: label, errors: result.errors }));
    }
  } catch (error) {
    invalid++;
    console.log(
      JSON.stringify({
        source: label,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
async function main() {
  for (const name of (await readdir('templates'))
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    audit(`templates/${name}`, await readFile(`templates/${name}`, 'utf8'));
  }
  if (process.argv.includes('--database')) {
    if (!process.env.DATABASE_URL)
      throw new Error('Set DATABASE_URL to the database to audit.');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const { rows } = await client.query<{
        source: string;
        id: number;
        name: string;
        json: string;
      }>(`
        SELECT 'scoresheet_templates' AS source, id, name, schema AS json FROM scoresheet_templates
        UNION ALL
        SELECT 'scoresheet_field_templates' AS source, id, name, fields_json AS json FROM scoresheet_field_templates
        ORDER BY source, id
      `);
      for (const row of rows)
        audit(`${row.source}/${row.id} (${row.name})`, row.json);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  }
  console.log(
    `Audited ${checked} templates; ${invalid} invalid. No templates or scores changed.`,
  );
  if (invalid) process.exitCode = 1;
}
void main().catch((error) => {
  // Avoid echoing connection strings or credentials on connection failures.
  console.error(
    'Formula audit could not finish:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exitCode = 1;
});
