import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTeamRest } from '../../src/server/services/teamRest';
import { createTestDb, type TestDb } from './helpers/testDb';
import {
  seedBracket,
  seedBracketGame,
  seedDoubleSeedingMatch,
  seedEvent,
  seedQueueItem,
  seedTeam,
} from '../http/helpers/seed';

describe('team rest service', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => testDb.close());

  it('returns the latest completed appearance across all score sources', async () => {
    const event = await seedEvent(testDb.db);
    const otherEvent = await seedEvent(testDb.db, { name: 'Other' });
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const neverPlayed = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 103,
    });
    const otherTeam = await seedTeam(testDb.db, {
      event_id: otherEvent.id,
      team_number: 201,
    });

    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const bracketGame = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'completed',
    });
    await testDb.db.run(
      `UPDATE bracket_games SET completed_at = ? WHERE id = ?`,
      ['2026-08-25 10:00:00', bracketGame.id],
    );

    await testDb.db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
       VALUES (?, 1, 50, ?)`,
      [team1.id, '2026-08-25 11:00:00'],
    );

    const doubleMatch = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      team1_id: team2.id,
      status: 'completed',
    });
    await testDb.db.run(
      `UPDATE double_seeding_matches SET completed_at = ? WHERE id = ?`,
      ['2026-08-25 12:00:00', doubleMatch.id],
    );

    await testDb.db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
       VALUES (?, 1, 90, ?)`,
      [otherTeam.id, '2026-08-25 13:00:00'],
    );

    const rest = await getTeamRest(testDb.db, event.id);

    expect(rest.lastPlayedAt.get(team1.id)).toBe('2026-08-25T11:00:00.000Z');
    expect(rest.lastPlayedAt.get(team2.id)).toBe('2026-08-25T12:00:00.000Z');
    expect(rest.lastPlayedAt.has(neverPlayed.id)).toBe(false);
    expect(rest.lastPlayedAt.has(otherTeam.id)).toBe(false);
  });

  it('excludes byes, null scores, and unfinished matches', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const bye = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team.id,
      status: 'bye',
    });
    await testDb.db.run(
      'UPDATE bracket_games SET completed_at = CURRENT_TIMESTAMP WHERE id = ?',
      [bye.id],
    );
    await testDb.db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
       VALUES (?, 1, NULL, CURRENT_TIMESTAMP)`,
      [team.id],
    );
    const unfinished = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      team1_id: team.id,
      status: 'ready',
    });
    await testDb.db.run(
      'UPDATE double_seeding_matches SET completed_at = CURRENT_TIMESTAMP WHERE id = ?',
      [unfinished.id],
    );

    const rest = await getTeamRest(testDb.db, event.id);
    expect(rest.lastPlayedAt.has(team.id)).toBe(false);
  });

  it('marks only called, arrived, and on-table participants busy', async () => {
    const event = await seedEvent(testDb.db, { seeding_rounds: 5 });
    const statuses = ['called', 'arrived', 'on_table', 'queued', 'scored'];
    const teams = [];

    for (let index = 0; index < statuses.length; index++) {
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101 + index,
      });
      teams.push(team);
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: index + 1,
        seeding_team_id: team.id,
        seeding_round: 1,
        status: statuses[index],
      });
    }

    const rest = await getTeamRest(testDb.db, event.id);
    expect([...rest.busy].sort((a, b) => a - b)).toEqual(
      teams.slice(0, 3).map((team) => team.id),
    );
  });
});
