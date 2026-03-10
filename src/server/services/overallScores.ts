import { getDatabase } from '../database/connection';

export interface OverallScoreRow {
  team_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  doc_score: number;
  raw_seed_score: number;
  weighted_de_score: number;
  total: number;
}

/**
 * Compute overall scores for all teams in an event.
 * Combines documentation score + raw seeding score + weighted bracket (DE) score.
 * Returns rows sorted by total descending.
 */
export async function computeOverallScores(
  eventId: number,
): Promise<OverallScoreRow[]> {
  const db = await getDatabase();

  const teams = await db.all<{
    id: number;
    team_number: number;
    team_name: string;
    display_name: string | null;
  }>(
    'SELECT id, team_number, team_name, display_name FROM teams WHERE event_id = ? ORDER BY team_number ASC',
    [eventId],
  );

  const docScores = await db.all<{
    team_id: number;
    overall_score: number | null;
  }>(
    'SELECT team_id, overall_score FROM documentation_scores WHERE event_id = ?',
    [eventId],
  );

  const seedingRankings = await db.all<{
    team_id: number;
    raw_seed_score: number | null;
  }>(
    `SELECT sr.team_id, sr.raw_seed_score
     FROM seeding_rankings sr
     JOIN teams t ON sr.team_id = t.id
     WHERE t.event_id = ?`,
    [eventId],
  );

  const brackets = await db.all<{ id: number }>(
    'SELECT id FROM brackets WHERE event_id = ?',
    [eventId],
  );

  const deMap = new Map<number, number>();
  for (const bracket of brackets) {
    const entries = await db.all<{
      team_id: number | null;
      weighted_bracket_raw_score: number | null;
    }>(
      `SELECT team_id, weighted_bracket_raw_score
       FROM bracket_entries
       WHERE bracket_id = ? AND team_id IS NOT NULL`,
      [bracket.id],
    );
    for (const entry of entries) {
      if (entry.team_id != null && entry.weighted_bracket_raw_score != null) {
        deMap.set(entry.team_id, entry.weighted_bracket_raw_score);
      }
    }
  }

  const docByTeam = new Map(
    docScores.map((s) => [s.team_id, s.overall_score ?? 0]),
  );
  const seedByTeam = new Map(
    seedingRankings.map((s) => [s.team_id, s.raw_seed_score ?? 0]),
  );

  const rows: OverallScoreRow[] = teams.map((team) => {
    const doc = docByTeam.get(team.id) ?? 0;
    const seed = seedByTeam.get(team.id) ?? 0;
    const de = deMap.get(team.id) ?? 0;
    return {
      team_id: team.id,
      team_number: team.team_number,
      team_name: team.team_name,
      display_name: team.display_name,
      doc_score: doc,
      raw_seed_score: seed,
      weighted_de_score: de,
      total: doc + seed + de,
    };
  });

  rows.sort((a, b) => b.total - a.total);
  return rows;
}
