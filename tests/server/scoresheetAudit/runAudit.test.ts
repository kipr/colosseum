import { describe, expect, it } from 'vitest';
import type { Database } from '../../../src/server/database/connection';
import { runScoresheetAudit } from '../../../src/server/scoresheetAudit/runAudit';
import { createTestDb } from '../../sql/helpers/testDb';
import {
  seedEvent,
  seedEventScoresheetTemplate,
  seedScoresheetTemplate,
} from '../../http/helpers/seed';

function selectOnly(db: Database): { db: Database; statements: string[] } {
  const statements: string[] = [];
  const wrapped: Database = {
    get: async (sql, params) => {
      statements.push(sql);
      return db.get(sql, params);
    },
    all: async (sql, params) => {
      statements.push(sql);
      return db.all(sql, params);
    },
    run: async (sql) => {
      statements.push(sql);
      throw new Error(`unexpected write: ${sql}`);
    },
    exec: async (sql) => {
      statements.push(sql);
      throw new Error(`unexpected write: ${sql}`);
    },
    transaction: async () => {
      throw new Error('unexpected write: transaction');
    },
  };
  return { db: wrapped, statements };
}

describe('runScoresheetAudit database runner', () => {
  it('inventories templates and field templates without writing', async () => {
    const testDb = await createTestDb();
    try {
      const event = await seedEvent(testDb.db, { name: 'GCER' });
      const valid = await seedScoresheetTemplate(testDb.db, {
        name: 'Valid Schema',
        schema: JSON.stringify({
          title: 'Valid',
          fields: [{ id: 'name', label: 'Name', type: 'text' }],
        }),
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: valid.id,
        template_type: 'seeding',
      });
      await testDb.db.run(
        `INSERT INTO scoresheet_templates (name, schema, access_code)
         VALUES (?, ?, ?)`,
        ['Broken JSON', '{not-json', 'broken-code'],
      );
      await testDb.db.run(
        `INSERT INTO scoresheet_field_templates (name, description, fields_json)
         VALUES (?, ?, ?)`,
        [
          'Field Pack',
          null,
          JSON.stringify([
            { id: 'poms', label: 'Poms', type: 'number', min: 0 },
          ]),
        ],
      );

      const { db, statements } = selectOnly(testDb.db);
      const report = await runScoresheetAudit({ db });

      expect(statements.every((sql) => /^\s*SELECT/i.test(sql))).toBe(true);
      expect(report.summary.rowCount).toBe(3);
      expect(report.summary.parseFailures).toBe(1);

      const validRow = report.rows.find((row) => row.name === 'Valid Schema');
      expect(validRow?.kind).toBe('scoresheet_template');
      expect(validRow?.shape).toBe('schema_object');
      expect(validRow?.eventLinks).toEqual([
        {
          eventId: event.id,
          eventName: 'GCER',
          templateType: 'seeding',
        },
      ]);
      expect(validRow?.findings.map((item) => item.code)).toContain(
        'missing.schemaVersion',
      );

      const broken = report.rows.find((row) => row.name === 'Broken JSON');
      expect(broken?.shape).toBe('unparseable');
      expect(broken?.findings[0].code).toBe('json.parse');

      const fields = report.rows.find((row) => row.name === 'Field Pack');
      expect(fields?.kind).toBe('field_template');
      expect(fields?.shape).toBe('bare_field_array');
      expect(fields?.automaticNormalizationAvailable).toBe(false);
      expect(fields?.proposedNormalized).toBeNull();
    } finally {
      testDb.close();
    }
  });
});

describe('runScoresheetAudit fixtures', () => {
  it('audits the checked-in templates directory', async () => {
    const report = await runScoresheetAudit({ fixtures: 'templates' });
    expect(report.summary.rowCount).toBe(9);
    expect(report.summary.parseFailures).toBe(0);
    expect(
      report.rows.filter((row) => row.shape === 'bare_field_array'),
    ).toHaveLength(6);
    expect(
      report.rows.filter((row) => row.shape === 'schema_object'),
    ).toHaveLength(2);
    expect(report.rows.filter((row) => row.shape === 'wrapper')).toHaveLength(
      1,
    );
  });
});
