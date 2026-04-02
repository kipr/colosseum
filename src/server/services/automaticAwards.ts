/**
 * Computed spectator awards (DE placement, per-bracket composite overall, event overall).
 * Derived at read time from persisted rankings and scores — not stored separately.
 */

import { getDatabase } from '../database/connection';
import { computeOverallScores } from './overallScores';

export interface PublicAwardTeam {
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export type MedalKind = 'gold' | 'silver' | 'bronze';

export interface MedalPlacement {
  place: 1 | 2 | 3;
  medal: MedalKind;
  recipients: PublicAwardTeam[];
}

export interface DeBracketAwards {
  bracket_id: number;
  bracket_name: string;
  placements: MedalPlacement[];
}

export interface PerBracketOverallAwards {
  bracket_id: number;
  bracket_name: string;
  placements: MedalPlacement[];
}

export interface EventOverallAwards {
  placements: MedalPlacement[];
}

export interface AutomaticAwardsPublic {
  /** Double-elimination placement medals (ranks 1–3) per bracket that has a champion (rank 1). */
  de: DeBracketAwards[];
  /** Composite overall within each bracket (doc + seed + weighted DE), top three score groups. */
  perBracketOverall: PerBracketOverallAwards[];
  /** Event-wide overall (doc + seed + sum of weighted DE across brackets). */
  eventOverall: EventOverallAwards | null;
}

const MEDALS: MedalKind[] = ['gold', 'silver', 'bronze'];

function toPublicTeam(row: {
  team_number: number;
  team_name: string;
  display_name: string | null;
}): PublicAwardTeam {
  return {
    team_number: row.team_number,
    team_name: row.team_name,
    display_name: row.display_name,
  };
}

type TotalRow = PublicAwardTeam & { total: number };

/**
 * Top three distinct score groups (ties share a medal).
 */
function topThreeMedalPlacementsByTotal(
  rows: TotalRow[],
): MedalPlacement[] | null {
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.team_number - b.team_number;
  });

  const placements: MedalPlacement[] = [];
  let idx = 0;
  for (let p = 0; p < 3; p++) {
    if (idx >= sorted.length) break;
    const targetTotal = sorted[idx].total;
    const group: PublicAwardTeam[] = [];
    while (idx < sorted.length && sorted[idx].total === targetTotal) {
      const r = sorted[idx];
      group.push({
        team_number: r.team_number,
        team_name: r.team_name,
        display_name: r.display_name,
      });
      idx++;
    }
    placements.push({
      place: (p + 1) as 1 | 2 | 3,
      medal: MEDALS[p],
      recipients: group,
    });
  }

  return placements.length > 0 ? placements : null;
}

function buildDePlacementsForBracket(
  rows: Array<{
    final_rank: number | null;
    team_number: number;
    team_name: string;
    display_name: string | null;
  }>,
): MedalPlacement[] | null {
  const byRank = new Map<1 | 2 | 3, PublicAwardTeam[]>();
  for (const r of rows) {
    if (r.final_rank == null || r.final_rank < 1 || r.final_rank > 3) continue;
    const rank = r.final_rank as 1 | 2 | 3;
    const list = byRank.get(rank) ?? [];
    list.push(toPublicTeam(r));
    byRank.set(rank, list);
  }

  if (!byRank.has(1) || byRank.get(1)!.length === 0) {
    return null;
  }

  const placements: MedalPlacement[] = [];
  for (const rank of [1, 2, 3] as const) {
    const rec = byRank.get(rank);
    if (rec && rec.length > 0) {
      placements.push({
        place: rank,
        medal: MEDALS[rank - 1],
        recipients: rec,
      });
    }
  }

  return placements.length > 0 ? placements : null;
}

async function fetchBracketOverallRows(
  eventId: number,
  bracketId: number,
): Promise<
  Array<{
    final_rank: number | null;
    total: number;
    team_number: number;
    team_name: string;
    display_name: string | null;
  }>
> {
  const db = await getDatabase();
  return db.all(
    `SELECT be.final_rank,
            COALESCE(ds.overall_score, 0) + COALESCE(sr.raw_seed_score, 0) +
              COALESCE(be.weighted_bracket_raw_score, 0) AS total,
            t.team_number, t.team_name, t.display_name
     FROM bracket_entries be
     LEFT JOIN teams t ON be.team_id = t.id
     LEFT JOIN documentation_scores ds
       ON ds.team_id = be.team_id AND ds.event_id = ?
     LEFT JOIN seeding_rankings sr ON sr.team_id = be.team_id
     WHERE be.bracket_id = ?
       AND be.is_bye = ?
       AND be.team_id IS NOT NULL`,
    [eventId, bracketId, false],
  );
}

/**
 * True when every non-bye, real-team bracket entry has a final DE rank (bracket fully ranked).
 */
function bracketFullyRanked(
  rows: Array<{ final_rank: number | null }>,
): boolean {
  return rows.length > 0 && rows.every((r) => r.final_rank != null);
}

export async function computeAutomaticAwards(
  eventId: number,
): Promise<AutomaticAwardsPublic> {
  const db = await getDatabase();

  const brackets = await db.all<{ id: number; name: string }>(
    `SELECT id, name FROM brackets WHERE event_id = ? ORDER BY id ASC`,
    [eventId],
  );

  const de: DeBracketAwards[] = [];
  const perBracketOverall: PerBracketOverallAwards[] = [];

  for (const b of brackets) {
    const deRows = await db.all<{
      final_rank: number | null;
      team_number: number;
      team_name: string;
      display_name: string | null;
    }>(
      `SELECT be.final_rank, t.team_number, t.team_name, t.display_name
       FROM bracket_entries be
       JOIN teams t ON be.team_id = t.id
       WHERE be.bracket_id = ? AND be.is_bye = ? AND be.team_id IS NOT NULL`,
      [b.id, false],
    );

    const dePlacements = buildDePlacementsForBracket(deRows);
    if (dePlacements) {
      de.push({
        bracket_id: b.id,
        bracket_name: b.name,
        placements: dePlacements,
      });
    }

    const overallRows = await fetchBracketOverallRows(eventId, b.id);
    if (overallRows.length === 0) continue;

    if (!bracketFullyRanked(overallRows)) {
      continue;
    }

    const forTotals = overallRows.map((r) => ({
      team_number: r.team_number,
      team_name: r.team_name,
      display_name: r.display_name,
      total: r.total,
    }));

    const obPlacements = topThreeMedalPlacementsByTotal(forTotals);
    if (obPlacements) {
      perBracketOverall.push({
        bracket_id: b.id,
        bracket_name: b.name,
        placements: obPlacements,
      });
    }
  }

  const overallRows = await computeOverallScores(eventId);
  const eventPlacements = topThreeMedalPlacementsByTotal(overallRows);

  return {
    de,
    perBracketOverall,
    eventOverall: eventPlacements ? { placements: eventPlacements } : null,
  };
}

/** Names of event_awards rows created by {@link applyAutomaticAwardsAsEventAwards}. */
export const AUTO_AWARD_NAME_PREFIX = 'Auto: ';

function ordinalLabel(place: 1 | 2 | 3): string {
  return place === 1 ? '1st' : place === 2 ? '2nd' : '3rd';
}

type PlannedAutoAward = {
  name: string;
  description: string | null;
  teamNumbers: number[];
};

function collectPlannedAutoAwards(
  auto: AutomaticAwardsPublic,
): PlannedAutoAward[] {
  const planned: PlannedAutoAward[] = [];

  for (const b of auto.de) {
    for (const p of b.placements) {
      planned.push({
        name: `${AUTO_AWARD_NAME_PREFIX}DE — ${b.bracket_name} — ${ordinalLabel(p.place)}`,
        description: 'Double elimination placement (computed).',
        teamNumbers: p.recipients.map((r) => r.team_number),
      });
    }
  }

  for (const b of auto.perBracketOverall) {
    for (const p of b.placements) {
      planned.push({
        name: `${AUTO_AWARD_NAME_PREFIX}Per-bracket overall — ${b.bracket_name} — ${ordinalLabel(p.place)}`,
        description:
          'Documentation + seeding + weighted DE within this bracket (computed).',
        teamNumbers: p.recipients.map((r) => r.team_number),
      });
    }
  }

  if (auto.eventOverall) {
    for (const p of auto.eventOverall.placements) {
      planned.push({
        name: `${AUTO_AWARD_NAME_PREFIX}Event overall — ${ordinalLabel(p.place)}`,
        description: 'Event-wide total score (computed).',
        teamNumbers: p.recipients.map((r) => r.team_number),
      });
    }
  }

  return planned;
}

/**
 * Remove existing auto-generated event awards for this event (name prefix
 * {@link AUTO_AWARD_NAME_PREFIX}) and insert fresh rows from
 * {@link computeAutomaticAwards}. Admin-only.
 */
export async function applyAutomaticAwardsAsEventAwards(
  eventId: number,
): Promise<{
  created: number;
  removed: number;
}> {
  const db = await getDatabase();
  const auto = await computeAutomaticAwards(eventId);
  const planned = collectPlannedAutoAwards(auto);

  const allTeamNumbers = new Set<number>();
  for (const a of planned) {
    for (const n of a.teamNumbers) {
      allTeamNumbers.add(n);
    }
  }

  const teamNumberToId = new Map<number, number>();
  if (allTeamNumbers.size > 0) {
    const nums = Array.from(allTeamNumbers);
    const placeholders = nums.map(() => '?').join(',');
    const rows = await db.all<{ id: number; team_number: number }>(
      `SELECT id, team_number FROM teams WHERE event_id = ? AND team_number IN (${placeholders})`,
      [eventId, ...nums],
    );
    for (const r of rows) {
      teamNumberToId.set(r.team_number, r.id);
    }
  }

  return db.transaction(async (tx) => {
    const del = await tx.run(
      `DELETE FROM event_awards WHERE event_id = ? AND name LIKE ?`,
      [eventId, `${AUTO_AWARD_NAME_PREFIX}%`],
    );
    const removed = del.changes ?? 0;

    if (planned.length === 0) {
      return { created: 0, removed };
    }

    let created = 0;
    for (const a of planned) {
      const ins = await tx.run(
        `INSERT INTO event_awards (event_id, template_award_id, name, description, sort_order)
         VALUES (?, NULL, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM event_awards WHERE event_id = ?))`,
        [eventId, a.name, a.description, eventId],
      );
      const awardId = ins.lastID;
      if (awardId == null) {
        throw new Error('Failed to insert event award');
      }
      for (const tn of a.teamNumbers) {
        const teamId = teamNumberToId.get(tn);
        if (teamId == null) continue;
        await tx.run(
          `INSERT INTO event_award_recipients (event_award_id, team_id) VALUES (?, ?)`,
          [awardId, teamId],
        );
      }
      created++;
    }

    return { created, removed };
  });
}
