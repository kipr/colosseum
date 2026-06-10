import { getDatabase } from '../database/connection';

export interface OverallScoreRow {
  team_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  doc_score: number;
  raw_seed_score: number;
  raw_double_seed_score: number;
  weighted_de_score: number;
  total: number;
}

/**
 * Shared SQL for bracket-entry-scoped overall totals:
 * documentation + raw seeding + raw double seeding + weighted DE.
 *
 * Expects the query to alias bracket_entries as `be` and provide the event id
 * as the first parameter (for the documentation_scores join). Use together so
 * every overall-total query computes the same formula.
 */
export const BRACKET_OVERALL_TOTAL_SQL = `COALESCE(ds.overall_score, 0) + COALESCE(sr.raw_seed_score, 0) +
                  COALESCE(dsr.raw_double_seed_score, 0) +
                  COALESCE(be.weighted_bracket_raw_score, 0)`;

export const BRACKET_OVERALL_JOINS_SQL = `LEFT JOIN documentation_scores ds
           ON ds.team_id = be.team_id AND ds.event_id = ?
         LEFT JOIN seeding_rankings sr ON sr.team_id = be.team_id
         LEFT JOIN double_seeding_rankings dsr ON dsr.team_id = be.team_id`;

/**
 * Compute overall scores for all teams in an event.
 * Combines documentation score + raw seeding score + raw double-seeding score
 * + weighted bracket (DE) score. Returns rows sorted by total descending.
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

  const doubleSeedingRankings = await db.all<{
    team_id: number;
    raw_double_seed_score: number | null;
  }>(
    `SELECT dsr.team_id, dsr.raw_double_seed_score
     FROM double_seeding_rankings dsr
     JOIN teams t ON dsr.team_id = t.id
     WHERE t.event_id = ?`,
    [eventId],
  );

  const bracketEntries = await db.all<{
    team_id: number | null;
    weighted_bracket_raw_score: number | null;
  }>(
    `SELECT team_id, weighted_bracket_raw_score
     FROM bracket_entries
     WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id = ?)
       AND team_id IS NOT NULL`,
    [eventId],
  );

  /** Sum weighted DE contribution across all brackets (team may appear in multiple brackets). */
  const deMap = new Map<number, number>();
  for (const entry of bracketEntries) {
    if (entry.team_id != null && entry.weighted_bracket_raw_score != null) {
      const prev = deMap.get(entry.team_id) ?? 0;
      deMap.set(entry.team_id, prev + entry.weighted_bracket_raw_score);
    }
  }

  const docByTeam = new Map(
    docScores.map((s) => [s.team_id, s.overall_score ?? 0]),
  );
  const seedByTeam = new Map(
    seedingRankings.map((s) => [s.team_id, s.raw_seed_score ?? 0]),
  );
  const doubleSeedByTeam = new Map(
    doubleSeedingRankings.map((s) => [s.team_id, s.raw_double_seed_score ?? 0]),
  );

  const rows: OverallScoreRow[] = teams.map((team) => {
    const doc = docByTeam.get(team.id) ?? 0;
    const seed = seedByTeam.get(team.id) ?? 0;
    const doubleSeed = doubleSeedByTeam.get(team.id) ?? 0;
    const de = deMap.get(team.id) ?? 0;
    return {
      team_id: team.id,
      team_number: team.team_number,
      team_name: team.team_name,
      display_name: team.display_name,
      doc_score: doc,
      raw_seed_score: seed,
      raw_double_seed_score: doubleSeed,
      weighted_de_score: de,
      total: doc + seed + doubleSeed + de,
    };
  });

  rows.sort((a, b) => b.total - a.total);
  return rows;
}
