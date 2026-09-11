import { nextPowerOfTwo } from '../../shared/brackets';
import type { Bracket, CreateBracketBody } from '../../shared/brackets';
import type { Database } from '../database/connection';
import { recalculateSeedingRankings } from './seedingRankings';
import { materializeBracketGames } from './bracketGenerateGames';
import { markQueueDirty } from './queueVersion';
import { serviceFail, serviceOk, type ServiceResult } from './serviceResult';
import type { TeamAssignmentConflict } from '../../shared/brackets';

export interface CreateBracketInput extends CreateBracketBody {
  created_by: number | null;
}

type CreateBracketFailure = {
  team_ids?: number[];
  conflicts?: TeamAssignmentConflict[];
};

export async function createBracket(
  db: Database,
  input: CreateBracketInput,
): Promise<ServiceResult<Bracket, CreateBracketFailure>> {
  const {
    event_id,
    name,
    bracket_size,
    actual_team_count,
    status,
    weight,
    team_ids,
    created_by,
  } = input;

  if (
    weight !== undefined &&
    (typeof weight !== 'number' || weight <= 0 || weight > 1)
  ) {
    return serviceFail(400, 'weight must be a number in (0, 1]');
  }
  const bracketWeight: number = weight ?? 1.0;

  if (Array.isArray(team_ids) && team_ids.length > 0) {
    return createBracketWithTeams(db, {
      event_id,
      name,
      status,
      created_by,
      teamIds: team_ids,
      bracketWeight,
    });
  }

  if (!event_id || !name || !bracket_size) {
    return serviceFail(400, 'event_id, name, and bracket_size are required');
  }

  const result = await db.run(
    `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, weight, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      event_id,
      name,
      bracket_size,
      actual_team_count ?? null,
      status || 'setup',
      bracketWeight,
      created_by,
    ],
  );

  const bracket = await db.get<Bracket>('SELECT * FROM brackets WHERE id = ?', [
    result.lastID,
  ]);
  if (!bracket) {
    return serviceFail(500, 'Failed to create bracket');
  }
  return serviceOk(bracket, 201);
}

async function createBracketWithTeams(
  db: Database,
  input: {
    event_id: number;
    name: string;
    status?: string;
    created_by: number | null;
    teamIds: number[];
    bracketWeight: number;
  },
): Promise<ServiceResult<Bracket, CreateBracketFailure>> {
  const { event_id, name, status, created_by, teamIds, bracketWeight } = input;

  if (!event_id || !name) {
    return serviceFail(
      400,
      'event_id and name are required when team_ids provided',
    );
  }

  const uniqueIds = [...new Set(teamIds)];
  if (uniqueIds.length !== teamIds.length) {
    return serviceFail(400, 'team_ids must be unique');
  }

  const event = await db.get('SELECT id FROM events WHERE id = ?', [event_id]);
  if (!event) {
    return serviceFail(400, 'Event does not exist');
  }

  const placeholders = teamIds.map(() => '?').join(',');
  const teams = await db.all<{ id: number; event_id: number }>(
    `SELECT id, event_id FROM teams WHERE id IN (${placeholders})`,
    teamIds,
  );
  const foundIds = new Set(teams.map((t) => t.id));
  const notFound = teamIds.filter((id) => !foundIds.has(id));
  if (notFound.length > 0) {
    return serviceFail(400, 'One or more team_ids not found', {
      team_ids: notFound,
    });
  }
  const wrongEvent = teams.filter((t) => t.event_id !== event_id);
  if (wrongEvent.length > 0) {
    return serviceFail(
      400,
      'All teams must belong to the same event as the bracket',
      { team_ids: wrongEvent.map((t) => t.id) },
    );
  }

  const assigned = await db.all<TeamAssignmentConflict>(
    `SELECT be.team_id, t.team_number, t.team_name, b.id as bracket_id, b.name as bracket_name
         FROM bracket_entries be
         JOIN brackets b ON be.bracket_id = b.id
         JOIN teams t ON be.team_id = t.id
         WHERE b.event_id = ? AND be.team_id IS NOT NULL AND be.team_id IN (${placeholders})`,
    [event_id, ...teamIds],
  );
  if (assigned.length > 0) {
    return serviceFail(
      409,
      'One or more teams are already assigned to a bracket at this event',
      {
        conflicts: assigned.map((a) => ({
          team_id: a.team_id,
          team_number: a.team_number,
          team_name: a.team_name,
          bracket_id: a.bracket_id,
          bracket_name: a.bracket_name,
        })),
      },
    );
  }

  const actualTeamCount = teamIds.length;
  const bracketSize = nextPowerOfTwo(actualTeamCount);
  if (bracketSize > 64) {
    return serviceFail(
      400,
      `Too many teams (${actualTeamCount}). Maximum bracket size is 64.`,
    );
  }

  await recalculateSeedingRankings(event_id);

  const rankings = await db.all<{
    team_id: number;
    seed_rank: number | null;
    team_number: number;
  }>(
    `SELECT sr.team_id, sr.seed_rank, t.team_number
         FROM seeding_rankings sr
         JOIN teams t ON sr.team_id = t.id
         WHERE sr.team_id IN (${placeholders})
         ORDER BY sr.seed_rank ASC NULLS LAST, t.team_number ASC`,
    teamIds,
  );
  const teamIdToRank = new Map(rankings.map((r, i) => [r.team_id, i + 1]));
  const orderedTeamIds = teamIds
    .slice()
    .sort(
      (a, b) => (teamIdToRank.get(a) ?? 999) - (teamIdToRank.get(b) ?? 999),
    );

  let bracketId: number | null = null;
  await db.transaction(async (tx) => {
    const br = await tx.run(
      `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, weight, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        event_id,
        name,
        bracketSize,
        actualTeamCount,
        status || 'setup',
        bracketWeight,
        created_by,
      ],
    );
    const newBracketId = br.lastID!;
    bracketId = newBracketId;

    for (let seedPosition = 1; seedPosition <= bracketSize; seedPosition++) {
      const teamId =
        seedPosition <= orderedTeamIds.length
          ? orderedTeamIds[seedPosition - 1]
          : null;
      const isBye = teamId === null;
      await tx.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
             VALUES (?, ?, ?, ?) RETURNING id`,
        [newBracketId, teamId, seedPosition, isBye],
      );
    }
  });

  if (!bracketId) {
    throw new Error('Failed to create bracket');
  }

  const gamesResult = await materializeBracketGames(db, bracketId, bracketSize);
  if (!gamesResult.ok) {
    return serviceFail(gamesResult.status, gamesResult.error);
  }

  await markQueueDirty(db, Number(event_id));

  const bracket = await db.get<Bracket>('SELECT * FROM brackets WHERE id = ?', [
    bracketId,
  ]);
  if (!bracket) {
    return serviceFail(500, 'Failed to create bracket');
  }
  return serviceOk(bracket, 201);
}
