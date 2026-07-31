/**
 * Advisory diagnostics for common admin mistakes before applying automatic awards.
 */

import { getDatabase } from '../database/connection';
import type {
  AutomaticAwardDiagnostics,
  DuplicateBracketWeightIssue,
  ZeroScoreComponent,
  ZeroScoreIssue,
} from '../../shared/automaticAwards';

/**
 * Find teams with a zero or missing active overall-score component, and
 * duplicate bracket weights when an event has multiple brackets.
 */
export async function computeAutomaticAwardDiagnostics(
  eventId: number,
): Promise<AutomaticAwardDiagnostics> {
  const db = await getDatabase();

  const event = await db.get<{ double_seeding_rounds: number | null }>(
    'SELECT double_seeding_rounds FROM events WHERE id = ?',
    [eventId],
  );
  const doubleSeedingEnabled = (event?.double_seeding_rounds ?? 0) > 0;

  const teams = await db.all<{
    id: number;
    team_number: number;
    team_name: string;
    display_name: string | null;
  }>(
    `SELECT id, team_number, team_name, display_name
     FROM teams WHERE event_id = ? ORDER BY team_number ASC`,
    [eventId],
  );

  const docScores = await db.all<{
    team_id: number;
    overall_score: number | null;
  }>(
    'SELECT team_id, overall_score FROM documentation_scores WHERE event_id = ?',
    [eventId],
  );
  const docByTeam = new Map(docScores.map((s) => [s.team_id, s.overall_score]));

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
  const seedByTeam = new Map(
    seedingRankings.map((s) => [s.team_id, s.raw_seed_score]),
  );

  const doubleSeedByTeam = new Map<number, number | null>();
  if (doubleSeedingEnabled) {
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
    for (const s of doubleSeedingRankings) {
      doubleSeedByTeam.set(s.team_id, s.raw_double_seed_score);
    }
  }

  const bracketEntries = await db.all<{
    team_id: number | null;
    weighted_bracket_raw_score: number | null;
  }>(
    `SELECT team_id, weighted_bracket_raw_score
     FROM bracket_entries
     WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id = ?)
       AND team_id IS NOT NULL
       AND is_bye = ?`,
    [eventId, false],
  );

  const deMap = new Map<number, number>();
  const teamsInBrackets = new Set<number>();
  for (const entry of bracketEntries) {
    if (entry.team_id == null) continue;
    teamsInBrackets.add(entry.team_id);
    if (entry.weighted_bracket_raw_score != null) {
      const prev = deMap.get(entry.team_id) ?? 0;
      deMap.set(entry.team_id, prev + entry.weighted_bracket_raw_score);
    }
  }

  const zeroScoreIssues: ZeroScoreIssue[] = [];
  for (const team of teams) {
    const components: ZeroScoreComponent[] = [];

    const doc = docByTeam.get(team.id);
    if (doc == null || doc === 0) {
      components.push('documentation');
    }

    const seed = seedByTeam.get(team.id);
    if (seed == null || seed === 0) {
      components.push('seeding');
    }

    if (doubleSeedingEnabled) {
      const doubleSeed = doubleSeedByTeam.get(team.id);
      if (doubleSeed == null || doubleSeed === 0) {
        components.push('double_seeding');
      }
    }

    // Only flag DE for teams that appear in a bracket (or if brackets exist and
    // the team has no weighted contribution). Missing DE for non-bracket teams
    // is expected when brackets are not yet populated for everyone; still warn
    // when the team is in a bracket with null/zero weighted score, or when any
    // brackets exist and the team has zero total DE contribution.
    const hasBrackets = teamsInBrackets.size > 0;
    if (hasBrackets) {
      const de = deMap.get(team.id);
      if (de == null || de === 0) {
        components.push('weighted_de');
      }
    }

    if (components.length > 0) {
      zeroScoreIssues.push({
        team_id: team.id,
        team_number: team.team_number,
        team_name: team.team_name,
        display_name: team.display_name,
        components,
      });
    }
  }

  const brackets = await db.all<{
    id: number;
    name: string;
    weight: number;
  }>(
    `SELECT id, name, weight FROM brackets WHERE event_id = ? ORDER BY id ASC`,
    [eventId],
  );

  const duplicateBracketWeights: DuplicateBracketWeightIssue[] = [];
  if (brackets.length > 1) {
    const byWeight = new Map<number, { id: number; name: string }[]>();
    for (const b of brackets) {
      const list = byWeight.get(b.weight) ?? [];
      list.push({ id: b.id, name: b.name });
      byWeight.set(b.weight, list);
    }
    for (const [weight, group] of byWeight) {
      if (group.length > 1) {
        duplicateBracketWeights.push({ weight, brackets: group });
      }
    }
    duplicateBracketWeights.sort((a, b) => a.weight - b.weight);
  }

  return { zeroScoreIssues, duplicateBracketWeights };
}
