/**
 * Schema tests for the double-seeding tables and widened CHECK constraints.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';
import {
  seedEvent,
  seedTeam,
  seedDoubleSeedingMatch,
  seedDoubleSeedingScore,
  seedQueueItem,
  seedScoresheetTemplate,
  seedEventScoresheetTemplate,
} from '../http/helpers/seed';

describe('Double seeding schema (SQLite)', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('creates the double-seeding tables', async () => {
    const tables = await testDb.db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'double_seeding%' ORDER BY name`,
    );
    expect(tables.map((t) => t.name)).toEqual([
      'double_seeding_matches',
      'double_seeding_rankings',
      'double_seeding_scores',
    ]);
  });

  it('adds double_seeding_match_id to score_submissions and game_queue', async () => {
    const submissionCols = await testDb.db.all<{ name: string }>(
      `PRAGMA table_info(score_submissions)`,
    );
    expect(submissionCols.map((c) => c.name)).toContain(
      'double_seeding_match_id',
    );

    const queueCols = await testDb.db.all<{ name: string }>(
      `PRAGMA table_info(game_queue)`,
    );
    expect(queueCols.map((c) => c.name)).toContain('double_seeding_match_id');
  });

  it('adds double_seeding_rounds to events with default 0', async () => {
    const event = await seedEvent(testDb.db);
    const row = await testDb.db.get(
      'SELECT double_seeding_rounds FROM events WHERE id = ?',
      [event.id],
    );
    expect(row?.double_seeding_rounds).toBe(0);
  });

  it('enforces one score per match side and one score per team/round', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
    });

    await seedDoubleSeedingScore(testDb.db, {
      event_id: event.id,
      match_id: match.id,
      team_id: team1.id,
      round_number: 1,
      side: 'team1',
      score: 10,
    });

    // Same match/side again
    await expect(
      seedDoubleSeedingScore(testDb.db, {
        event_id: event.id,
        match_id: match.id,
        team_id: team2.id,
        round_number: 1,
        side: 'team1',
        score: 20,
      }),
    ).rejects.toThrow(/UNIQUE/);

    // Same team/round in another match
    const otherMatch = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      match_number: 2,
      team1_id: team1.id,
    });
    await expect(
      seedDoubleSeedingScore(testDb.db, {
        event_id: event.id,
        match_id: otherMatch.id,
        team_id: team1.id,
        round_number: 1,
        side: 'team1',
        score: 30,
      }),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('rejects invalid double-seeding score sides', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      team1_id: team.id,
    });

    await expect(
      testDb.db.run(
        `INSERT INTO double_seeding_scores (event_id, match_id, team_id, round_number, side, score)
         VALUES (?, ?, ?, ?, 'left', 1)`,
        [event.id, match.id, team.id, 1],
      ),
    ).rejects.toThrow(/CHECK/);
  });

  it('accepts queue_type double_seeding with a match id and rejects mixed identities', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      team1_id: team.id,
    });

    const item = await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'double_seeding',
      double_seeding_match_id: match.id,
      queue_position: 1,
    });
    expect(item.id).toBeGreaterThan(0);

    // double_seeding without match id
    await expect(
      seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'double_seeding',
        queue_position: 2,
      }),
    ).rejects.toThrow(/CHECK/);

    // seeding identity must not carry a double-seeding match id
    await expect(
      seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        seeding_team_id: team.id,
        seeding_round: 1,
        double_seeding_match_id: match.id,
        queue_position: 3,
      }),
    ).rejects.toThrow(/CHECK/);
  });

  it('deletes queue rows when the linked match is deleted (CASCADE)', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      team1_id: team.id,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'double_seeding',
      double_seeding_match_id: match.id,
      queue_position: 1,
    });

    await testDb.db.run('DELETE FROM double_seeding_matches WHERE id = ?', [
      match.id,
    ]);

    const rows = await testDb.db.all(
      `SELECT * FROM game_queue WHERE queue_type = 'double_seeding'`,
    );
    expect(rows.length).toBe(0);
  });

  it('allows event_scoresheet_templates.template_type = double_seeding', async () => {
    const event = await seedEvent(testDb.db);
    const template = await seedScoresheetTemplate(testDb.db);
    const link = await seedEventScoresheetTemplate(testDb.db, {
      event_id: event.id,
      template_id: template.id,
      template_type: 'double_seeding',
    });
    expect(link.id).toBeGreaterThan(0);

    await expect(
      seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: template.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        template_type: 'bogus' as any,
      }),
    ).rejects.toThrow(/CHECK/);
  });

  it('rejects invalid double_seeding_matches statuses', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    await expect(
      seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        team1_id: team.id,
        status: 'bogus',
      }),
    ).rejects.toThrow(/CHECK/);
  });
});
