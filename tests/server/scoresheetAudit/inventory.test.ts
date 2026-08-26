import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discriminateShape,
  inventoryDocument,
  rowFromJsonText,
} from '../../../src/server/scoresheetAudit/inventory';

const TEMPLATES_DIR = path.join(__dirname, '../../../templates');

function codes(input: unknown): string[] {
  return inventoryDocument(input).findings.map((finding) => finding.code);
}

function finding(
  input: unknown,
  code: string,
): { path: string; candidateMigration: string | null; message: string } {
  const match = inventoryDocument(input).findings.find(
    (item) => item.code === code,
  );
  expect(match, `expected finding ${code}`).toBeDefined();
  return match!;
}

describe('checked-in templates/', () => {
  const files = fs
    .readdirSync(TEMPLATES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();

  it('contains nine JSON templates', () => {
    expect(files).toHaveLength(9);
  });

  it('recognizes the three document shapes', () => {
    const shapes = files.map((name) => {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8'),
      );
      return { name, shape: discriminateShape(parsed) };
    });

    const byShape = {
      bare_field_array: shapes.filter((s) => s.shape === 'bare_field_array'),
      schema_object: shapes.filter((s) => s.shape === 'schema_object'),
      wrapper: shapes.filter((s) => s.shape === 'wrapper'),
    };

    expect(byShape.bare_field_array).toHaveLength(6);
    expect(byShape.schema_object.map((s) => s.name).sort()).toEqual([
      'botball-de-template.json',
      'botball-seeding-template.json',
    ]);
    expect(byShape.wrapper.map((s) => s.name)).toEqual([
      'test-default-values.json',
    ]);
  });

  it('finds id and label on every checked-in field', () => {
    for (const name of files) {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8'),
      );
      const result = inventoryDocument(parsed);
      expect(
        result.findings.filter(
          (item) => item.code === 'missing.id' || item.code === 'missing.label',
        ),
        name,
      ).toEqual([]);
    }
  });

  it('flags Sheets-era sources and both cascade formats on Botball templates', () => {
    const seeding = JSON.parse(
      fs.readFileSync(
        path.join(TEMPLATES_DIR, 'botball-seeding-template.json'),
        'utf8',
      ),
    );
    const de = JSON.parse(
      fs.readFileSync(
        path.join(TEMPLATES_DIR, 'botball-de-template.json'),
        'utf8',
      ),
    );

    expect(codes(seeding)).toContain('legacy.sheetsDataSource');
    expect(codes(seeding)).toContain('legacy.cascadeFormatA');
    expect(codes(de)).toContain('legacy.sheetsDataSource');
    expect(codes(de)).toContain('legacy.cascadeFormatB');
  });
});

describe('synthetic inventory detectors', () => {
  it('reports json.parse for invalid text', () => {
    const row = rowFromJsonText({
      kind: 'scoresheet_template',
      id: 1,
      name: 'broken',
      jsonText: '{not json',
    });
    expect(row.shape).toBe('unparseable');
    expect(row.findings.some((item) => item.code === 'json.parse')).toBe(true);
    expect(row.automaticNormalizationAvailable).toBe(false);
    expect(row.proposedNormalized).toBeNull();
  });

  it('reports json.parse for empty text', () => {
    const row = rowFromJsonText({
      kind: 'field_template',
      id: 2,
      name: 'empty',
      jsonText: '  ',
    });
    expect(row.shape).toBe('unparseable');
    expect(row.findings[0].code).toBe('json.parse');
  });

  it('classifies unknown marker objects and non-objects', () => {
    expect(discriminateShape({ mode: 'head-to-head' })).toBe('unknown');
    expect(codes({ mode: 'head-to-head' })).toContain('shape.unknown');
    expect(codes(null)).toContain('shape.unknown');
    expect(codes('nope')).toContain('shape.unknown');
  });

  it('flags missing schemaVersion on schema objects and wrappers', () => {
    expect(
      finding({ fields: [] }, 'missing.schemaVersion').candidateMigration,
    ).toBe('add-schema-version');
    expect(codes({ name: 'w', schema: { fields: [] } })).toContain(
      'missing.schemaVersion',
    );
    expect(codes([])).not.toContain('missing.schemaVersion');
  });

  it('detects bracketSource: true', () => {
    const hit = finding(
      { fields: [], bracketSource: true },
      'legacy.bracketSourceTrue',
    );
    expect(hit.path).toBe('bracketSource');
    expect(hit.candidateMigration).toBe('normalize-bracket-source-true');
  });

  it('detects bracketSource.bracketId', () => {
    const hit = finding(
      { fields: [], bracketSource: { type: 'db', bracketId: 9 } },
      'legacy.bracketId',
    );
    expect(hit.candidateMigration).toBe('preserve-bracket-id');
  });

  it('detects Sheets-era dataSource, bracketSource, and teamsDataSource', () => {
    const doc = {
      fields: [
        {
          id: 'team',
          label: 'Team',
          type: 'dropdown',
          dataSource: { sheetName: 'Teams', range: 'A1:B' },
        },
      ],
      bracketSource: { sheetName: 'DE 16 Team' },
      teamsDataSource: { sheetName: 'Teams' },
    };
    const result = inventoryDocument(doc);
    const sheets = result.findings.filter(
      (item) => item.code === 'legacy.sheetsDataSource',
    );
    expect(sheets.map((item) => item.path).sort()).toEqual([
      'bracketSource',
      'fields[team].dataSource',
      'teamsDataSource',
    ]);
  });

  it('detects cascade format A and B', () => {
    expect(
      codes({
        fields: [
          {
            id: 'team',
            label: 'Team',
            type: 'dropdown',
            cascades: { targetField: 'name', sourceField: 'Team Name' },
          },
        ],
      }),
    ).toContain('legacy.cascadeFormatA');

    expect(
      finding(
        {
          fields: [
            {
              id: 'game',
              label: 'Game',
              type: 'dropdown',
              cascades: { team_a_number: 'team1.teamNumber' },
            },
          ],
        },
        'legacy.cascadeFormatB',
      ).candidateMigration,
    ).toBe('cascade-format-b');
  });

  it('detects field-level name without id/label', () => {
    const hit = finding([{ name: 'Poms', type: 'number' }], 'legacy.fieldName');
    expect(hit.candidateMigration).toBe('field-template-name-to-id-label');
    expect(codes([{ name: 'Poms', type: 'number' }])).toEqual(
      expect.arrayContaining(['missing.id', 'missing.label']),
    );
  });

  it('classifies missing header vs scoring ids', () => {
    const header = finding(
      [{ type: 'section_header', label: 'SIDE A' }],
      'missing.id',
    );
    expect(header.candidateMigration).toBe('add-header-ids');
    expect(header.message).toContain('Header');

    const scoring = finding([{ type: 'number', label: 'Poms' }], 'missing.id');
    expect(scoring.candidateMigration).toBeNull();
    expect(scoring.message).toContain('Scoring');
  });

  it('detects startValue', () => {
    expect(
      codes([{ id: 'name', label: 'Name', type: 'text', startValue: 'old' }]),
    ).toEqual(
      expect.arrayContaining(['legacy.startValue', 'validation.defaultValue']),
    );
  });

  it('detects queueConfig and useQueueForSeeding watch keys', () => {
    const doc = {
      fields: [],
      queueConfig: { enabled: true },
      useQueueForSeeding: true,
    };
    expect(codes(doc)).toEqual(
      expect.arrayContaining(['watch.queueConfig', 'watch.useQueueForSeeding']),
    );
    expect(inventoryDocument(doc).propertyInventory.unknownSchemaKeys).toEqual(
      [],
    );
  });

  it('detects unknown schema and field keys', () => {
    const result = inventoryDocument({
      fields: [
        {
          id: 'x',
          label: 'X',
          type: 'text',
          mysteryField: true,
        },
      ],
      mysterySchema: 1,
    });
    expect(result.findings.map((item) => item.code)).toEqual(
      expect.arrayContaining(['unknown.schemaKey', 'unknown.fieldKey']),
    );
    expect(result.propertyInventory.unknownSchemaKeys).toEqual([
      'mysterySchema',
    ]);
    expect(result.propertyInventory.unknownFieldKeys).toEqual(['mysteryField']);
  });

  it('walks repeatableGroup children', () => {
    const result = inventoryDocument([
      {
        id: 'stacks',
        label: 'Stacks',
        type: 'repeatableGroup',
        fields: [{ type: 'number', label: 'Count' }],
      },
    ]);
    const missing = result.findings.find(
      (item) =>
        item.code === 'missing.id' && item.path === 'fields[stacks].fields[0]',
    );
    expect(missing).toBeDefined();
  });

  it('surfaces existing defaultValue validation errors', () => {
    const result = inventoryDocument({
      fields: [
        { id: 'score', label: 'Score', type: 'number', defaultValue: 'nope' },
      ],
    });
    expect(result.currentValidationErrors.length).toBeGreaterThan(0);
    expect(
      result.findings.some((item) => item.code === 'validation.defaultValue'),
    ).toBe(true);
  });
});
