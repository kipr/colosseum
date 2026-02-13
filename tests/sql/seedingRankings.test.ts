/**
 * Seeding rankings calculation tests - verify the ranking algorithm works correctly.
 * Tests the core SQL + algorithm logic from the seeding routes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';

describe('Seeding Rankings Calculation', () => {
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
   * Helper to add seeding scores for a team
   */
  async function addSeedingScore(
    teamId: number,
    roundNumber: number,
    score: number | null,
  ): Promise<void> {
    await testDb.db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)`,
      [teamId, roundNumber, score],
    );
  }

  /**
   * Recalculate rankings for the event - mirrors the route logic
   */
  async function recalculateRankings(): Promise<void> {
    const teams = await testDb.db.all<{ id: number }>(
      'SELECT id FROM teams WHERE event_id = ?',
      [eventId],
    );

    const rankings: {
      teamId: number;
      seedAverage: number | null;
      tiebreaker: number | null;
    }[] = [];

    for (const team of teams) {
      const scores = await testDb.db.all<{ score: number }>(
        'SELECT score FROM seeding_scores WHERE team_id = ? AND score IS NOT NULL ORDER BY score DESC',
        [team.id],
      );

      let seedAverage: number | null = null;
      let tiebreaker: number | null = null;

      if (scores.length >= 2) {
        // Average of top 2 scores
        seedAverage = (scores[0].score + scores[1].score) / 2;
        // Tiebreaker: 3rd score if available, else sum of all
        tiebreaker =
          scores.length >= 3
            ? scores[2].score
            : scores.reduce((sum, s) => sum + s.score, 0);
      } else if (scores.length === 1) {
        seedAverage = scores[0].score;
        tiebreaker = scores[0].score;
      }

      rankings.push({ teamId: team.id, seedAverage, tiebreaker });
    }

    // Sort by seed_average DESC, then tiebreaker DESC
    rankings.sort((a, b) => {
      if (a.seedAverage === null && b.seedAverage === null) return 0;
      if (a.seedAverage === null) return 1;
      if (b.seedAverage === null) return -1;
      if (a.seedAverage !== b.seedAverage) return b.seedAverage - a.seedAverage;
      if (a.tiebreaker === null && b.tiebreaker === null) return 0;
      if (a.tiebreaker === null) return 1;
      if (b.tiebreaker === null) return -1;
      return b.tiebreaker - a.tiebreaker;
    });

    // Calculate raw seed score
    const maxAverage =
      rankings.find((r) => r.seedAverage !== null)?.seedAverage || 1;
    const rankedTeams = rankings.filter((r) => r.seedAverage !== null);
    const n = rankedTeams.length;

    // Update rankings in database
    await testDb.db.transaction((tx) => {
      for (let i = 0; i < rankings.length; i++) {
        const r = rankings[i];
        const seedRank = r.seedAverage !== null ? i + 1 : null;

        let rawSeedScore: number | null = null;
        if (r.seedAverage !== null && seedRank !== null && n > 0) {
          const rankComponent = (3 / 4) * ((n - seedRank + 1) / n);
          const scoreComponent = (1 / 4) * (r.seedAverage / maxAverage);
          rawSeedScore = rankComponent + scoreComponent;
        }

        tx.run(
          `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score, tiebreaker_value)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(team_id) DO UPDATE SET
             seed_average = excluded.seed_average,
             seed_rank = excluded.seed_rank,
             raw_seed_score = excluded.raw_seed_score,
             tiebreaker_value = excluded.tiebreaker_value`,
          [r.teamId, r.seedAverage, seedRank, rawSeedScore, r.tiebreaker],
        );
      }
    });
  }

  describe('average calculation', () => {
    it('should calculate average of top 2 scores when team has 3 scores', async () => {
      const teamId = await createTeam(100);

      // Scores: 150, 120, 100 -> top 2 average = (150 + 120) / 2 = 135
      await addSeedingScore(teamId, 1, 150);
      await addSeedingScore(teamId, 2, 120);
      await addSeedingScore(teamId, 3, 100);

      await recalculateRankings();

      const ranking = await testDb.db.get<{ seed_average: number }>(
        `SELECT seed_average FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );

      expect(ranking?.seed_average).toBe(135);
    });

    it('should calculate average of top 2 scores when team has 2 scores', async () => {
      const teamId = await createTeam(100);

      // Scores: 150, 120 -> top 2 average = (150 + 120) / 2 = 135
      await addSeedingScore(teamId, 1, 150);
      await addSeedingScore(teamId, 2, 120);

      await recalculateRankings();

      const ranking = await testDb.db.get<{ seed_average: number }>(
        `SELECT seed_average FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );

      expect(ranking?.seed_average).toBe(135);
    });

    it('should use single score when team has only 1 score', async () => {
      const teamId = await createTeam(100);

      await addSeedingScore(teamId, 1, 150);

      await recalculateRankings();

      const ranking = await testDb.db.get<{ seed_average: number }>(
        `SELECT seed_average FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );

      expect(ranking?.seed_average).toBe(150);
    });

    it('should have null average when team has no scores', async () => {
      const teamId = await createTeam(100);

      await recalculateRankings();

      const ranking = await testDb.db.get<{ seed_average: number | null }>(
        `SELECT seed_average FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );

      expect(ranking?.seed_average).toBeNull();
    });
  });

  describe('tiebreaker calculation', () => {
    it('should use 3rd score as tiebreaker when available', async () => {
      const teamId = await createTeam(100);

      // Scores: 150, 120, 100 -> tiebreaker = 100
      await addSeedingScore(teamId, 1, 150);
      await addSeedingScore(teamId, 2, 120);
      await addSeedingScore(teamId, 3, 100);

      await recalculateRankings();

      const ranking = await testDb.db.get<{ tiebreaker_value: number }>(
        `SELECT tiebreaker_value FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );

      expect(ranking?.tiebreaker_value).toBe(100);
    });

    it('should use sum of scores as tiebreaker when only 2 scores', async () => {
      const teamId = await createTeam(100);

      // Scores: 150, 120 -> tiebreaker = 150 + 120 = 270
      await addSeedingScore(teamId, 1, 150);
      await addSeedingScore(teamId, 2, 120);

      await recalculateRankings();

      const ranking = await testDb.db.get<{ tiebreaker_value: number }>(
        `SELECT tiebreaker_value FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );

      expect(ranking?.tiebreaker_value).toBe(270);
    });
  });

  describe('ranking order', () => {
    it('should rank teams by seed_average descending', async () => {
      const team1 = await createTeam(100); // Average: 135
      const team2 = await createTeam(200); // Average: 150
      const team3 = await createTeam(300); // Average: 100

      await addSeedingScore(team1, 1, 150);
      await addSeedingScore(team1, 2, 120);

      await addSeedingScore(team2, 1, 160);
      await addSeedingScore(team2, 2, 140);

      await addSeedingScore(team3, 1, 110);
      await addSeedingScore(team3, 2, 90);

      await recalculateRankings();

      const rankings = await testDb.db.all<{
        team_id: number;
        seed_rank: number;
      }>(
        `SELECT team_id, seed_rank FROM seeding_rankings ORDER BY seed_rank ASC`,
      );

      expect(rankings[0].team_id).toBe(team2); // Highest average (150)
      expect(rankings[0].seed_rank).toBe(1);

      expect(rankings[1].team_id).toBe(team1); // Second (135)
      expect(rankings[1].seed_rank).toBe(2);

      expect(rankings[2].team_id).toBe(team3); // Third (100)
      expect(rankings[2].seed_rank).toBe(3);
    });

    it('should use tiebreaker when averages are equal', async () => {
      const team1 = await createTeam(100); // Average: 135, tiebreaker: 80
      const team2 = await createTeam(200); // Average: 135, tiebreaker: 100

      await addSeedingScore(team1, 1, 150);
      await addSeedingScore(team1, 2, 120);
      await addSeedingScore(team1, 3, 80);

      await addSeedingScore(team2, 1, 150);
      await addSeedingScore(team2, 2, 120);
      await addSeedingScore(team2, 3, 100);

      await recalculateRankings();

      const rankings = await testDb.db.all<{
        team_id: number;
        seed_rank: number;
      }>(
        `SELECT team_id, seed_rank FROM seeding_rankings ORDER BY seed_rank ASC`,
      );

      // Team 2 has higher tiebreaker, should be ranked first
      expect(rankings[0].team_id).toBe(team2);
      expect(rankings[0].seed_rank).toBe(1);

      expect(rankings[1].team_id).toBe(team1);
      expect(rankings[1].seed_rank).toBe(2);
    });

    it('should put teams with no scores at the bottom (null rank)', async () => {
      const team1 = await createTeam(100); // Has scores
      const team2 = await createTeam(200); // No scores

      await addSeedingScore(team1, 1, 150);
      await addSeedingScore(team1, 2, 120);

      await recalculateRankings();

      const ranking1 = await testDb.db.get<{ seed_rank: number }>(
        `SELECT seed_rank FROM seeding_rankings WHERE team_id = ?`,
        [team1],
      );
      const ranking2 = await testDb.db.get<{ seed_rank: number | null }>(
        `SELECT seed_rank FROM seeding_rankings WHERE team_id = ?`,
        [team2],
      );

      expect(ranking1?.seed_rank).toBe(1);
      expect(ranking2?.seed_rank).toBeNull();
    });
  });

  describe('raw_seed_score formula', () => {
    it('should calculate raw_seed_score using the official formula', async () => {
      const team1 = await createTeam(100); // Rank 1
      const team2 = await createTeam(200); // Rank 2
      const team3 = await createTeam(300); // Rank 3

      // Team 1: average 150 (highest)
      await addSeedingScore(team1, 1, 160);
      await addSeedingScore(team1, 2, 140);

      // Team 2: average 120
      await addSeedingScore(team2, 1, 130);
      await addSeedingScore(team2, 2, 110);

      // Team 3: average 100
      await addSeedingScore(team3, 1, 110);
      await addSeedingScore(team3, 2, 90);

      await recalculateRankings();

      // Formula: (3/4) × ((n - SeedRank + 1) / n) + (1/4) × (TeamAverageSeedScore / MaxTournamentSeedScore)
      // n = 3, maxAverage = 150

      // Team 1 (rank 1): (3/4) × ((3 - 1 + 1) / 3) + (1/4) × (150 / 150) = 0.75 × 1 + 0.25 × 1 = 1.0
      const ranking1 = await testDb.db.get<{ raw_seed_score: number }>(
        `SELECT raw_seed_score FROM seeding_rankings WHERE team_id = ?`,
        [team1],
      );
      expect(ranking1?.raw_seed_score).toBeCloseTo(1.0, 5);

      // Team 2 (rank 2): (3/4) × ((3 - 2 + 1) / 3) + (1/4) × (120 / 150) = 0.75 × (2/3) + 0.25 × 0.8 = 0.5 + 0.2 = 0.7
      const ranking2 = await testDb.db.get<{ raw_seed_score: number }>(
        `SELECT raw_seed_score FROM seeding_rankings WHERE team_id = ?`,
        [team2],
      );
      expect(ranking2?.raw_seed_score).toBeCloseTo(0.7, 5);

      // Team 3 (rank 3): (3/4) × ((3 - 3 + 1) / 3) + (1/4) × (100 / 150) = 0.75 × (1/3) + 0.25 × (2/3) = 0.25 + 0.167 ≈ 0.417
      const ranking3 = await testDb.db.get<{ raw_seed_score: number }>(
        `SELECT raw_seed_score FROM seeding_rankings WHERE team_id = ?`,
        [team3],
      );
      expect(ranking3?.raw_seed_score).toBeCloseTo(0.4167, 3);
    });

    it('should have null raw_seed_score for unranked teams', async () => {
      const teamId = await createTeam(100);
      // No scores

      await recalculateRankings();

      const ranking = await testDb.db.get<{ raw_seed_score: number | null }>(
        `SELECT raw_seed_score FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );

      expect(ranking?.raw_seed_score).toBeNull();
    });
  });

  describe('upsert behavior', () => {
    it('should update existing rankings when recalculated', async () => {
      const teamId = await createTeam(100);

      // First round of scores
      await addSeedingScore(teamId, 1, 100);
      await recalculateRankings();

      let ranking = await testDb.db.get<{ seed_average: number }>(
        `SELECT seed_average FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );
      expect(ranking?.seed_average).toBe(100);

      // Add more scores and recalculate
      await addSeedingScore(teamId, 2, 150);
      await recalculateRankings();

      ranking = await testDb.db.get<{ seed_average: number }>(
        `SELECT seed_average FROM seeding_rankings WHERE team_id = ?`,
        [teamId],
      );
      expect(ranking?.seed_average).toBe(125); // (150 + 100) / 2
    });
  });
});
