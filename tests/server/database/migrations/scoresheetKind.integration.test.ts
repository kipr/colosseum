/**
 * Database integration tests for the scoresheet kind migration.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDb, TestDb } from '../../../sql/helpers/testDb';
import {
  applyScoresheetKindMigration,
  checkScoresheetKindMigration,
  formatScoresheetKindCheckLine,
  ScoresheetKindMigrationError,
} from '../../../../src/server/database/migrations/scoresheetKind';
import {
  seedEvent,
  seedEventScoresheetTemplate,
  seedScoreSubmission,
  seedScoresheetTemplate,
  seedUser,
} from '../../../http/helpers/seed';

describe('scoresheet kind migration orchestration', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('converts every row including inactive and unlinked templates', async () => {
    const event = await seedEvent(testDb.db, { status: 'complete' });
    const seeding = await seedScoresheetTemplate(testDb.db, {
      name: 'Legacy Seeding',
      schema: JSON.stringify({ title: 'Seed', fields: [{ id: 'score' }] }),
    });
    const bracket = await seedScoresheetTemplate(testDb.db, {
      name: 'Legacy Bracket',
      schema: JSON.stringify({
        mode: 'head-to-head',
        bracketSource: { type: 'db', eventId: event.id },
        fields: [],
      }),
    });
    const doubleSeeding = await seedScoresheetTemplate(testDb.db, {
      name: 'Legacy Double Seeding',
      schema: JSON.stringify({
        scoreKind: 'double_seeding',
        fields: [],
      }),
    });
    const unlinked = await seedScoresheetTemplate(testDb.db, {
      name: 'Unlinked',
      schema: JSON.stringify({ fields: [] }),
    });
    await testDb.db.run(
      'UPDATE scoresheet_templates SET is_active = FALSE WHERE id = ?',
      [seeding.id],
    );
    await seedEventScoresheetTemplate(testDb.db, {
      event_id: event.id,
      template_id: seeding.id,
      template_type: 'seeding',
    });
    await seedEventScoresheetTemplate(testDb.db, {
      event_id: event.id,
      template_id: bracket.id,
      template_type: 'bracket',
    });
    await seedEventScoresheetTemplate(testDb.db, {
      event_id: event.id,
      template_id: doubleSeeding.id,
      template_type: 'double_seeding',
    });

    const report = await applyScoresheetKindMigration(testDb.db);
    expect(report.errorCount).toBe(0);
    expect(report.changedCount).toBe(4);

    const rows = await testDb.db.all(
      'SELECT id, name, schema, is_active FROM scoresheet_templates ORDER BY id',
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(JSON.parse(byId.get(seeding.id).schema).kind).toBe('seeding');
    expect(JSON.parse(byId.get(bracket.id).schema).kind).toBe('bracket');
    expect(JSON.parse(byId.get(doubleSeeding.id).schema).kind).toBe(
      'double_seeding',
    );
    expect(JSON.parse(byId.get(unlinked.id).schema).kind).toBe('seeding');
    expect(JSON.parse(byId.get(bracket.id).schema).mode).toBeUndefined();
    expect(
      JSON.parse(byId.get(doubleSeeding.id).schema).scoreKind,
    ).toBeUndefined();
    expect(Number(byId.get(seeding.id).is_active)).toBe(0);

    const second = await applyScoresheetKindMigration(testDb.db);
    expect(second.changedCount).toBe(0);
    expect(second.unchangedCount).toBe(4);
  });

  it('rolls back every template update when one row is invalid', async () => {
    await seedScoresheetTemplate(testDb.db, {
      name: 'Valid',
      schema: JSON.stringify({ fields: [] }),
    });
    await seedScoresheetTemplate(testDb.db, {
      name: 'Invalid',
      schema: '{',
    });

    await expect(
      applyScoresheetKindMigration(testDb.db),
    ).rejects.toBeInstanceOf(ScoresheetKindMigrationError);

    const rows = await testDb.db.all(
      'SELECT name, schema FROM scoresheet_templates ORDER BY id',
    );
    expect(JSON.parse(rows[0].schema)).toEqual({ fields: [] });
    expect(rows[1].schema).toBe('{');
  });

  it('preserves template and score-submission IDs', async () => {
    const user = await seedUser(testDb.db);
    const event = await seedEvent(testDb.db, { status: 'complete' });
    const template = await seedScoresheetTemplate(testDb.db, {
      name: 'Historical',
      schema: JSON.stringify({
        mode: 'head-to-head',
        bracketSource: { type: 'db', eventId: event.id },
        fields: [{ id: 'team_a_score', label: 'A' }],
      }),
    });
    await seedEventScoresheetTemplate(testDb.db, {
      event_id: event.id,
      template_id: template.id,
      template_type: 'bracket',
    });
    const score = await seedScoreSubmission(testDb.db, {
      user_id: user.id,
      template_id: template.id,
      event_id: event.id,
      score_type: 'bracket',
      score_data: JSON.stringify({
        team_a_score: { type: 'number', value: 12, label: 'A' },
      }),
    });

    await applyScoresheetKindMigration(testDb.db);

    const storedTemplate = await testDb.db.get(
      'SELECT id FROM scoresheet_templates WHERE id = ?',
      [template.id],
    );
    const storedScore = await testDb.db.get(
      'SELECT id, template_id FROM score_submissions WHERE id = ?',
      [score.id],
    );
    expect(storedTemplate.id).toBe(template.id);
    expect(storedScore.id).toBe(score.id);
    expect(storedScore.template_id).toBe(template.id);
  });

  it('check mode reports current and target archetypes plus submission counts', async () => {
    const user = await seedUser(testDb.db);
    const template = await seedScoresheetTemplate(testDb.db, {
      name: 'With Scores',
      schema: JSON.stringify({ fields: [] }),
    });
    await seedScoreSubmission(testDb.db, {
      user_id: user.id,
      template_id: template.id,
      score_data: JSON.stringify({}),
    });

    const report = await checkScoresheetKindMigration(testDb.db);
    expect(report.changedCount).toBe(1);
    expect(report.templates[0].submissionCount).toBe(1);
    expect(formatScoresheetKindCheckLine(report.templates[0])).toContain(
      'action=migrate',
    );
    expect(formatScoresheetKindCheckLine(report.templates[0])).toContain(
      'submissions=1',
    );
  });
});

describe('ScoreViewModal historical schema source', () => {
  it('does not request the public judge template list', () => {
    const source = readFileSync(
      'src/client/components/admin/ScoreViewModal.tsx',
      'utf8',
    );
    expect(source).not.toContain('/scoresheet/templates');
    expect(source).toContain('template_schema');
  });
});
