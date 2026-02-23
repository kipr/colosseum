/**
 * Queue population from seeding tests - verify queue is populated correctly
 * based on unplayed seeding rounds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';

describe('Queue Population from Seeding', () => {
  let testDb: TestDb;
  let eventId: number;

  beforeEach(async () => {
    testDb = await createTestDb();

    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status, seeding_rounds) VALUES (?, ?, ?)`,
      ['Test Event', 'setup', 3],
    );
    eventId = eventResult.lastID!;
  });

  afterEach(() => {
    testDb.close();
  });

  /**
   * Helper to create a team
   */
  async function createTeam(teamNumber: number): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
      [eventId, teamNumber, `Team ${teamNumber}`],
    );
    return result.lastID!;
  }

  /**
   * Helper to add seeding score
   */
  async function addSeedingScore(
    teamId: number,
    roundNumber: number,
    score: number,
  ): Promise<void> {
    await testDb.db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)`,
      [teamId, roundNumber, score],
    );
  }

  /**
   * Populate queue from seeding - mirrors the route logic
   */
  async function populateQueueFromSeeding(): Promise<{
    created: number;
    totalTeams: number;
    totalRounds: number;
  }> {
    const event = await testDb.db.get<{ id: number; seeding_rounds: number }>(
      'SELECT id, seeding_rounds FROM events WHERE id = ?',
      [eventId],
    );

    if (!event) throw new Error('Event not found');

    const seedingRounds = event.seeding_rounds || 3;

    const teams = await testDb.db.all<{ id: number; team_number: number }>(
      'SELECT id, team_number FROM teams WHERE event_id = ? ORDER BY team_number ASC',
      [eventId],
    );

    if (teams.length === 0) {
      throw new Error('No teams found for this event');
    }

    const teamIds = teams.map((t) => t.id);
    const scoredRounds = await testDb.db.all<{
      team_id: number;
      round_number: number;
    }>(
      `SELECT team_id, round_number FROM seeding_scores
       WHERE team_id IN (${teamIds.map(() => '?').join(',')})
         AND score IS NOT NULL`,
      teamIds,
    );

    const scoredSet = new Set(
      scoredRounds.map((s) => `${s.team_id}:${s.round_number}`),
    );

    const unplayedRounds: { team_id: number; round: number }[] = [];
    for (let round = 1; round <= seedingRounds; round++) {
      for (const team of teams) {
        const key = `${team.id}:${round}`;
        if (!scoredSet.has(key)) {
          unplayedRounds.push({ team_id: team.id, round });
        }
      }
    }

    // Clear existing queue
    await testDb.db.run('DELETE FROM game_queue WHERE event_id = ?', [eventId]);

    // Insert unplayed rounds
    let created = 0;
    for (let i = 0; i < unplayedRounds.length; i++) {
      const item = unplayedRounds[i];
      await testDb.db.run(
        `INSERT INTO game_queue (
           event_id, seeding_team_id, seeding_round, queue_type, queue_position, status
         ) VALUES (?, ?, ?, 'seeding', ?, 'queued')`,
        [eventId, item.team_id, item.round, i + 1],
      );
      created++;
    }

    return {
      created,
      totalTeams: teams.length,
      totalRounds: seedingRounds,
    };
  }

  describe('basic population', () => {
    it('should create queue entries for all unplayed rounds', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const team1 = await createTeam(100);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const team2 = await createTeam(200);

      // Event has 3 seeding rounds, no scores yet
      const result = await populateQueueFromSeeding();

      // 2 teams × 3 rounds = 6 queue entries
      expect(result.created).toBe(6);
      expect(result.totalTeams).toBe(2);
      expect(result.totalRounds).toBe(3);

      const queue = await testDb.db.all(
        `SELECT * FROM game_queue WHERE event_id = ?`,
        [eventId],
      );
      expect(queue).toHaveLength(6);
    });

    it('should exclude already scored rounds', async () => {
      const team1 = await createTeam(100);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const team2 = await createTeam(200);

      // Team 1 has round 1 scored
      await addSeedingScore(team1, 1, 150);

      const result = await populateQueueFromSeeding();

      // Team 1: 2 rounds (2, 3)
      // Team 2: 3 rounds (1, 2, 3)
      // Total: 5
      expect(result.created).toBe(5);

      const queue = await testDb.db.all(
        `SELECT * FROM game_queue WHERE event_id = ?`,
        [eventId],
      );
      expect(queue).toHaveLength(5);

      // Verify team 1 round 1 is not in queue
      const team1Round1 = queue.find(
        (q: { seeding_team_id: number; seeding_round: number }) =>
          q.seeding_team_id === team1 && q.seeding_round === 1,
      );
      expect(team1Round1).toBeUndefined();
    });

    it('should exclude all scored rounds when all are played', async () => {
      const team1 = await createTeam(100);

      // All 3 rounds scored
      await addSeedingScore(team1, 1, 150);
      await addSeedingScore(team1, 2, 120);
      await addSeedingScore(team1, 3, 100);

      const result = await populateQueueFromSeeding();

      expect(result.created).toBe(0);

      const queue = await testDb.db.all(
        `SELECT * FROM game_queue WHERE event_id = ?`,
        [eventId],
      );
      expect(queue).toHaveLength(0);
    });
  });

  describe('queue ordering', () => {
    it('should order queue entries by position', async () => {
      await createTeam(100);
      await createTeam(200);

      await populateQueueFromSeeding();

      const queue = await testDb.db.all<{ queue_position: number }>(
        `SELECT * FROM game_queue WHERE event_id = ? ORDER BY queue_position ASC`,
        [eventId],
      );

      // Positions should be sequential 1, 2, 3, ...
      for (let i = 0; i < queue.length; i++) {
        expect(queue[i].queue_position).toBe(i + 1);
      }
    });

    it('should order by round then team number', async () => {
      const team1 = await createTeam(100);
      const team2 = await createTeam(200);

      await populateQueueFromSeeding();

      const queue = await testDb.db.all<{
        seeding_team_id: number;
        seeding_round: number;
        queue_position: number;
      }>(
        `SELECT * FROM game_queue WHERE event_id = ? ORDER BY queue_position ASC`,
        [eventId],
      );

      // Should be: team1-r1, team2-r1, team1-r2, team2-r2, team1-r3, team2-r3
      expect(queue[0].seeding_team_id).toBe(team1);
      expect(queue[0].seeding_round).toBe(1);

      expect(queue[1].seeding_team_id).toBe(team2);
      expect(queue[1].seeding_round).toBe(1);

      expect(queue[2].seeding_team_id).toBe(team1);
      expect(queue[2].seeding_round).toBe(2);

      expect(queue[3].seeding_team_id).toBe(team2);
      expect(queue[3].seeding_round).toBe(2);
    });
  });

  describe('queue replacement', () => {
    it('should clear existing queue before populating', async () => {
      const team1 = await createTeam(100);

      // First population
      await populateQueueFromSeeding();
      let queue = await testDb.db.all(
        `SELECT * FROM game_queue WHERE event_id = ?`,
        [eventId],
      );
      expect(queue).toHaveLength(3);

      // Add a score
      await addSeedingScore(team1, 1, 150);

      // Re-populate - should only have 2 entries now
      await populateQueueFromSeeding();
      queue = await testDb.db.all(
        `SELECT * FROM game_queue WHERE event_id = ?`,
        [eventId],
      );
      expect(queue).toHaveLength(2);
    });
  });

  describe('queue item properties', () => {
    it('should set correct queue_type for seeding entries', async () => {
      await createTeam(100);

      await populateQueueFromSeeding();

      const queue = await testDb.db.all(
        `SELECT * FROM game_queue WHERE event_id = ?`,
        [eventId],
      );

      for (const item of queue) {
        expect(item.queue_type).toBe('seeding');
        expect(item.status).toBe('queued');
        expect(item.bracket_game_id).toBeNull();
      }
    });

    it('should reference correct team and round', async () => {
      const team1 = await createTeam(100);

      await populateQueueFromSeeding();

      const queue = await testDb.db.all<{
        seeding_team_id: number;
        seeding_round: number;
      }>(`SELECT * FROM game_queue WHERE event_id = ?`, [eventId]);

      for (const item of queue) {
        expect(item.seeding_team_id).toBe(team1);
        expect(item.seeding_round).toBeGreaterThan(0);
        expect(item.seeding_round).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('event configuration', () => {
    it('should respect event seeding_rounds setting', async () => {
      // Update event to have 5 seeding rounds
      await testDb.db.run(`UPDATE events SET seeding_rounds = 5 WHERE id = ?`, [
        eventId,
      ]);

      await createTeam(100);

      const result = await populateQueueFromSeeding();

      expect(result.totalRounds).toBe(5);
      expect(result.created).toBe(5); // 1 team × 5 rounds
    });
  });

  describe('edge cases', () => {
    it('should handle event with no teams', async () => {
      await expect(populateQueueFromSeeding()).rejects.toThrow(
        'No teams found',
      );
    });

    it('should handle partial scoring across teams', async () => {
      const team1 = await createTeam(100);
      const team2 = await createTeam(200);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const team3 = await createTeam(300);

      // Team 1: all rounds scored
      await addSeedingScore(team1, 1, 150);
      await addSeedingScore(team1, 2, 120);
      await addSeedingScore(team1, 3, 100);

      // Team 2: 1 round scored
      await addSeedingScore(team2, 1, 140);

      // Team 3: no scores

      const result = await populateQueueFromSeeding();

      // Team 1: 0 unplayed
      // Team 2: 2 unplayed (rounds 2, 3)
      // Team 3: 3 unplayed (rounds 1, 2, 3)
      expect(result.created).toBe(5);
    });
  });
});
