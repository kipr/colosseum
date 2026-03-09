import { BracketDetail, BracketStatus, GameStatus } from '../../types/brackets';

export function getStatusClass(status: BracketStatus): string {
  switch (status) {
    case 'setup':
      return 'status-setup';
    case 'in_progress':
      return 'status-in-progress';
    case 'completed':
      return 'status-completed';
    default:
      return '';
  }
}

export function getGameStatusClass(status: GameStatus): string {
  switch (status) {
    case 'pending':
      return 'game-status-pending';
    case 'ready':
      return 'game-status-ready';
    case 'in_progress':
      return 'game-status-in-progress';
    case 'completed':
      return 'game-status-completed';
    case 'bye':
      return 'game-status-bye';
    default:
      return '';
  }
}

export function getBracketWinner(games: BracketDetail['games']): {
  team_id: number;
  team_number?: number;
  team_name?: string;
  team_display?: string | null;
} | null {
  const championshipGames = games.filter(
    (g) => g.winner_advances_to_id === null,
  );
  if (championshipGames.length === 0) return null;
  const champ = championshipGames.reduce((a, b) =>
    (a.game_number ?? 0) > (b.game_number ?? 0) ? a : b,
  );
  if (!champ.winner_id) return null;
  return {
    team_id: champ.winner_id,
    team_number: champ.winner_number,
    team_name: champ.winner_name,
    team_display: champ.winner_display,
  };
}
