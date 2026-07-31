/**
 * Computed spectator awards (DE placement, per-bracket composite overall, seeding).
 * Derived at read time from persisted rankings and scores — not stored separately
 * except when admin applies Auto: event award rows.
 */

import { getDatabase } from '../database/connection';
import {
  BRACKET_OVERALL_TOTAL_SQL,
  BRACKET_OVERALL_JOINS_SQL,
} from './overallScores';
import { computeAutomaticAwardDiagnostics } from './eventScoreDiagnostics';
import {
  DEFAULT_AUTOMATIC_AWARD_SETTINGS,
  diagnosticsHaveWarnings,
  medalForPlace,
  ordinalLabel,
  type AutomaticAwardDiagnostics,
  type AutomaticAwardSettings,
  type AutomaticAwardsPublic,
  type DeBracketAwards,
  type MedalPlacement,
  type PerBracketOverallAwards,
  type PublicAwardTeam,
  type SeedingAwards,
} from '../../shared/automaticAwards';

export type {
  AutomaticAwardDiagnostics,
  AutomaticAwardSettings,
  AutomaticAwardsPublic,
  DeBracketAwards,
  MedalPlacement,
  PerBracketOverallAwards,
  PublicAwardTeam,
  SeedingAwards,
};
export { DEFAULT_AUTOMATIC_AWARD_SETTINGS, ordinalLabel, medalForPlace };

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
 * Top N distinct score groups (ties share a place/medal).
 */
function topNMedalPlacementsByTotal(
  rows: TotalRow[],
  topN: number,
): MedalPlacement[] | null {
  if (topN <= 0 || rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.team_number - b.team_number;
  });

  const placements: MedalPlacement[] = [];
  let idx = 0;
  for (let p = 0; p < topN; p++) {
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
    const place = p + 1;
    placements.push({
      place,
      medal: medalForPlace(place),
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
  topN: number,
): MedalPlacement[] | null {
  if (topN <= 0) return null;

  const byRank = new Map<number, PublicAwardTeam[]>();
  for (const r of rows) {
    if (r.final_rank == null || r.final_rank < 1 || r.final_rank > topN) {
      continue;
    }
    const list = byRank.get(r.final_rank) ?? [];
    list.push(toPublicTeam(r));
    byRank.set(r.final_rank, list);
  }

  if (!byRank.has(1) || byRank.get(1)!.length === 0) {
    return null;
  }

  const placements: MedalPlacement[] = [];
  for (let rank = 1; rank <= topN; rank++) {
    const rec = byRank.get(rank);
    if (rec && rec.length > 0) {
      placements.push({
        place: rank,
        medal: medalForPlace(rank),
        recipients: rec,
      });
    }
  }

  return placements.length > 0 ? placements : null;
}

function buildSeedingPlacements(
  rows: Array<{
    seed_rank: number | null;
    team_number: number;
    team_name: string;
    display_name: string | null;
  }>,
  topN: number,
): MedalPlacement[] | null {
  if (topN <= 0) return null;

  const byRank = new Map<number, PublicAwardTeam[]>();
  for (const r of rows) {
    if (r.seed_rank == null || r.seed_rank < 1 || r.seed_rank > topN) continue;
    const list = byRank.get(r.seed_rank) ?? [];
    list.push(toPublicTeam(r));
    byRank.set(r.seed_rank, list);
  }

  if (!byRank.has(1) || byRank.get(1)!.length === 0) {
    return null;
  }

  const placements: MedalPlacement[] = [];
  for (let rank = 1; rank <= topN; rank++) {
    const rec = byRank.get(rank);
    if (rec && rec.length > 0) {
      placements.push({
        place: rank,
        medal: medalForPlace(rank),
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
            ${BRACKET_OVERALL_TOTAL_SQL} AS total,
            t.team_number, t.team_name, t.display_name
     FROM bracket_entries be
     LEFT JOIN teams t ON be.team_id = t.id
     ${BRACKET_OVERALL_JOINS_SQL}
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

export async function getEventTeamCount(eventId: number): Promise<number> {
  const db = await getDatabase();
  const row = await db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM teams WHERE event_id = ?',
    [eventId],
  );
  return Number(row?.count ?? 0);
}

export async function loadAutomaticAwardSettings(
  eventId: number,
): Promise<AutomaticAwardSettings> {
  const db = await getDatabase();
  const row = await db.get<{
    de_top_n: number;
    per_bracket_overall_top_n: number;
    seeding_top_n: number;
  }>(
    `SELECT de_top_n, per_bracket_overall_top_n, seeding_top_n
     FROM event_automatic_award_settings WHERE event_id = ?`,
    [eventId],
  );
  if (!row) {
    return { ...DEFAULT_AUTOMATIC_AWARD_SETTINGS };
  }
  return {
    de_top_n: row.de_top_n,
    per_bracket_overall_top_n: row.per_bracket_overall_top_n,
    seeding_top_n: row.seeding_top_n,
  };
}

export async function saveAutomaticAwardSettings(
  eventId: number,
  settings: AutomaticAwardSettings,
): Promise<void> {
  const db = await getDatabase();
  await db.run(
    `INSERT INTO event_automatic_award_settings
       (event_id, de_top_n, per_bracket_overall_top_n, seeding_top_n)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       de_top_n = excluded.de_top_n,
       per_bracket_overall_top_n = excluded.per_bracket_overall_top_n,
       seeding_top_n = excluded.seeding_top_n`,
    [
      eventId,
      settings.de_top_n,
      settings.per_bracket_overall_top_n,
      settings.seeding_top_n,
    ],
  );
}

export function clampAutomaticAwardSettings(
  settings: AutomaticAwardSettings,
  teamCount: number,
): AutomaticAwardSettings {
  const clamp = (n: number) => Math.max(0, Math.min(n, teamCount));
  return {
    de_top_n: clamp(settings.de_top_n),
    per_bracket_overall_top_n: clamp(settings.per_bracket_overall_top_n),
    seeding_top_n: clamp(settings.seeding_top_n),
  };
}

export function validateAutomaticAwardSettings(
  settings: AutomaticAwardSettings,
  teamCount: number,
): string | null {
  const fields: (keyof AutomaticAwardSettings)[] = [
    'de_top_n',
    'per_bracket_overall_top_n',
    'seeding_top_n',
  ];
  for (const key of fields) {
    const value = settings[key];
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > teamCount
    ) {
      return `${key} must be an integer from 0 through ${teamCount}`;
    }
  }
  return null;
}

export async function computeAutomaticAwards(
  eventId: number,
  settingsOverride?: AutomaticAwardSettings,
): Promise<AutomaticAwardsPublic> {
  const db = await getDatabase();
  const settings =
    settingsOverride ?? (await loadAutomaticAwardSettings(eventId));

  const brackets = await db.all<{ id: number; name: string }>(
    `SELECT id, name FROM brackets WHERE event_id = ? ORDER BY id ASC`,
    [eventId],
  );

  const de: DeBracketAwards[] = [];
  const perBracketOverall: PerBracketOverallAwards[] = [];
  const shouldIncludePerBracketOverall =
    brackets.length > 1 && settings.per_bracket_overall_top_n > 0;

  for (const b of brackets) {
    if (settings.de_top_n > 0) {
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

      const dePlacements = buildDePlacementsForBracket(
        deRows,
        settings.de_top_n,
      );
      if (dePlacements) {
        de.push({
          bracket_id: b.id,
          bracket_name: b.name,
          placements: dePlacements,
        });
      }
    }

    if (shouldIncludePerBracketOverall) {
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

      const obPlacements = topNMedalPlacementsByTotal(
        forTotals,
        settings.per_bracket_overall_top_n,
      );
      if (obPlacements) {
        perBracketOverall.push({
          bracket_id: b.id,
          bracket_name: b.name,
          placements: obPlacements,
        });
      }
    }
  }

  let seeding: SeedingAwards | null = null;
  if (settings.seeding_top_n > 0) {
    const seedingRows = await db.all<{
      seed_rank: number | null;
      team_number: number;
      team_name: string;
      display_name: string | null;
    }>(
      `SELECT sr.seed_rank, t.team_number, t.team_name, t.display_name
       FROM seeding_rankings sr
       JOIN teams t ON sr.team_id = t.id
       WHERE t.event_id = ?`,
      [eventId],
    );
    seedingRows.sort((a, b) => {
      if (a.seed_rank == null && b.seed_rank == null) {
        return a.team_number - b.team_number;
      }
      if (a.seed_rank == null) return 1;
      if (b.seed_rank == null) return -1;
      if (a.seed_rank !== b.seed_rank) return a.seed_rank - b.seed_rank;
      return a.team_number - b.team_number;
    });
    const seedingPlacements = buildSeedingPlacements(
      seedingRows,
      settings.seeding_top_n,
    );
    if (seedingPlacements) {
      seeding = { placements: seedingPlacements };
    }
  }

  return {
    de,
    perBracketOverall,
    seeding,
    settings: { ...settings },
  };
}

/** Names of event_awards rows created by {@link applyAutomaticAwardsAsEventAwards}. */
export const AUTO_AWARD_NAME_PREFIX = 'Auto: ';

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

  if (auto.seeding) {
    for (const p of auto.seeding.placements) {
      planned.push({
        name: `${AUTO_AWARD_NAME_PREFIX}Seeding — ${ordinalLabel(p.place)}`,
        description: 'Standalone seeding place (computed).',
        teamNumbers: p.recipients.map((r) => r.team_number),
      });
    }
  }

  return planned;
}

export class AutomaticAwardsAcknowledgementRequiredError extends Error {
  readonly diagnostics: AutomaticAwardDiagnostics;

  constructor(diagnostics: AutomaticAwardDiagnostics) {
    super('Warnings require acknowledgement before applying automatic awards');
    this.name = 'AutomaticAwardsAcknowledgementRequiredError';
    this.diagnostics = diagnostics;
  }
}

export class AutomaticAwardsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomaticAwardsValidationError';
  }
}

/**
 * Remove existing auto-generated event awards for this event (name prefix
 * {@link AUTO_AWARD_NAME_PREFIX}), persist settings, and insert fresh rows from
 * {@link computeAutomaticAwards}. Admin-only.
 */
export async function applyAutomaticAwardsAsEventAwards(
  eventId: number,
  settings: AutomaticAwardSettings,
  options: { acknowledgeWarnings?: boolean } = {},
): Promise<{
  created: number;
  removed: number;
  settings: AutomaticAwardSettings;
  diagnostics: AutomaticAwardDiagnostics;
  hasWarnings: boolean;
}> {
  const teamCount = await getEventTeamCount(eventId);
  const validationError = validateAutomaticAwardSettings(settings, teamCount);
  if (validationError) {
    throw new AutomaticAwardsValidationError(validationError);
  }

  const diagnostics = await computeAutomaticAwardDiagnostics(eventId);
  const hasWarnings = diagnosticsHaveWarnings(diagnostics);
  if (hasWarnings && !options.acknowledgeWarnings) {
    throw new AutomaticAwardsAcknowledgementRequiredError(diagnostics);
  }

  const db = await getDatabase();
  const auto = await computeAutomaticAwards(eventId, settings);
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

  const result = await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO event_automatic_award_settings
         (event_id, de_top_n, per_bracket_overall_top_n, seeding_top_n)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         de_top_n = excluded.de_top_n,
         per_bracket_overall_top_n = excluded.per_bracket_overall_top_n,
         seeding_top_n = excluded.seeding_top_n`,
      [
        eventId,
        settings.de_top_n,
        settings.per_bracket_overall_top_n,
        settings.seeding_top_n,
      ],
    );

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

  return {
    ...result,
    settings: { ...settings },
    diagnostics,
    hasWarnings,
  };
}
