import type { Database, DbExecutor } from '../database/connection';
import type {
  AdvanceExistingWinnerResult,
  AdvanceWinnerResult,
  AdvancementSlotUpdate,
} from '../../shared/brackets';
import { resolveBracketByes } from './bracketByeResolver';
import { markQueueDirty } from './queueVersion';
import { serviceFail, serviceOk, type ServiceResult } from './serviceResult';

export type SlotUpdate = AdvancementSlotUpdate;

interface AdvanceableGame {
  id: number;
  bracket_id: number;
  status: string;
  team1_id: number | null;
  team2_id: number | null;
  winner_id: number | null;
  loser_id: number | null;
  winner_advances_to_id: number | null;
  loser_advances_to_id: number | null;
  winner_slot: string | null;
  loser_slot: string | null;
}

export function slotUpdatesForGame(
  game: Pick<
    AdvanceableGame,
    | 'winner_advances_to_id'
    | 'winner_slot'
    | 'loser_advances_to_id'
    | 'loser_slot'
  >,
  winnerId: number,
  loserId: number | null,
): SlotUpdate[] {
  const updates: SlotUpdate[] = [];

  if (game.winner_advances_to_id && game.winner_slot) {
    updates.push({
      gameId: game.winner_advances_to_id,
      slot: game.winner_slot,
      teamId: winnerId,
    });
  }

  if (loserId && game.loser_advances_to_id && game.loser_slot) {
    updates.push({
      gameId: game.loser_advances_to_id,
      slot: game.loser_slot,
      teamId: loserId,
    });
  }

  return updates;
}

export async function applySlotUpdates(
  tx: DbExecutor,
  updates: SlotUpdate[],
): Promise<void> {
  for (const update of updates) {
    const column = update.slot === 'team1' ? 'team1_id' : 'team2_id';
    await tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
      update.teamId,
      update.gameId,
    ]);
  }
}

export async function markDestinationGamesReady(
  db: DbExecutor,
  updates: SlotUpdate[],
): Promise<void> {
  for (const update of updates) {
    const destGame = await db.get<{
      team1_id: number | null;
      team2_id: number | null;
      status: string;
    }>('SELECT * FROM bracket_games WHERE id = ?', [update.gameId]);
    if (
      destGame &&
      destGame.team1_id &&
      destGame.team2_id &&
      destGame.status === 'pending'
    ) {
      await db.run(`UPDATE bracket_games SET status = 'ready' WHERE id = ?`, [
        update.gameId,
      ]);
    }
  }
}

async function dirtyBracketQueue(
  db: Database,
  bracketId: number,
): Promise<void> {
  const owner = await db.get<{ event_id: number }>(
    'SELECT event_id FROM brackets WHERE id = ?',
    [bracketId],
  );
  if (owner) {
    await markQueueDirty(db, owner.event_id);
  }
}

export async function advanceExistingWinner(
  db: Database,
  gameId: number,
): Promise<ServiceResult<AdvanceExistingWinnerResult>> {
  const game = await db.get<AdvanceableGame>(
    'SELECT * FROM bracket_games WHERE id = ?',
    [gameId],
  );
  if (!game) {
    return serviceFail(404, 'Game not found');
  }

  if (!game.winner_id) {
    return serviceFail(400, 'Game has no winner to advance');
  }

  const updates = slotUpdatesForGame(game, game.winner_id, game.loser_id);

  await db.transaction(async (tx) => {
    await applySlotUpdates(tx, updates);
    await tx.run(
      `UPDATE bracket_games SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [gameId],
    );
  });

  const byeResolution = await resolveBracketByes(db, game.bracket_id);
  await dirtyBracketQueue(db, game.bracket_id);

  return serviceOk({
    message: 'Winner advanced',
    updates,
    byeResolution,
  });
}

export async function setWinnerAndAdvance(
  db: Database,
  bracketId: number,
  gameId: number,
  winnerId: number,
): Promise<ServiceResult<AdvanceWinnerResult>> {
  const game = await db.get<AdvanceableGame>(
    'SELECT * FROM bracket_games WHERE id = ? AND bracket_id = ?',
    [gameId, bracketId],
  );

  if (!game) {
    return serviceFail(404, 'Game not found in this bracket');
  }

  if (game.status === 'completed') {
    return serviceFail(400, 'Game is already completed');
  }

  if (game.team1_id !== winnerId && game.team2_id !== winnerId) {
    return serviceFail(400, 'winner_id must be one of the teams in the game');
  }

  const loserId = game.team1_id === winnerId ? game.team2_id : game.team1_id;
  const updates = slotUpdatesForGame(game, winnerId, loserId);

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE bracket_games SET
            winner_id = ?,
            loser_id = ?,
            result_type = 'standard',
            disqualified_team_id = NULL,
            status = 'completed',
            completed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      [winnerId, loserId, gameId],
    );
    await applySlotUpdates(tx, updates);
  });

  await markDestinationGamesReady(db, updates);

  const byeResolution = await resolveBracketByes(db, bracketId);
  await dirtyBracketQueue(db, bracketId);

  return serviceOk({
    message: 'Winner advanced successfully',
    winner_id: winnerId,
    loser_id: loserId,
    updates,
    byeResolution,
  });
}
