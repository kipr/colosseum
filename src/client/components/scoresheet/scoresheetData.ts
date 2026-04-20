import type { BracketGameOption } from '../scoresheetUtils';

/**
 * Map a raw bracket-game row coming from `/brackets/...` (either the per-bracket
 * or per-event scoreable variant) into the `BracketGameOption` shape used by
 * `ScoresheetFieldList`'s bracket selector. Centralised here so that data
 * shaping is not duplicated across DB / event-scoped fetches.
 */
export function mapDbGame(
  g: Record<string, unknown>,
  fallbackBracketId?: number,
): BracketGameOption {
  const team1 =
    g.team1_id != null && (g.team1_number != null || g.team1_name)
      ? {
          teamNumber: String(g.team1_number ?? g.team1_name ?? ''),
          displayName: String(
            g.team1_display || g.team1_name || g.team1_number,
          ),
        }
      : null;
  const team2 =
    g.team2_id != null && (g.team2_number != null || g.team2_name)
      ? {
          teamNumber: String(g.team2_number ?? g.team2_name ?? ''),
          displayName: String(
            g.team2_display || g.team2_name || g.team2_number,
          ),
        }
      : null;
  return {
    gameNumber: g.game_number as number,
    bracketId: (g.bracket_id as number) ?? fallbackBracketId,
    bracketName: g.bracket_name as string | null | undefined,
    roundName: g.round_name as string | null | undefined,
    bracketSide: g.bracket_side as string | null | undefined,
    queuePosition: (g.queue_position as number | null | undefined) ?? null,
    team1,
    team2,
    hasWinner: !!g.winner_id || g.status === 'completed',
    bracketGameId: (g.bracket_game_id as number) ?? (g.id as number),
  };
}

/**
 * Look up a team's full name from the loaded teams data, given a team number.
 * Tolerates several historical column variants used by uploaded CSVs.
 */
export function lookupTeamName(
  teamNumber: string,
  teamsData: Array<Record<string, unknown>>,
  teamNumberField: string = 'Team Number',
  teamNameField: string = 'Team Name',
): string {
  if (!teamNumber || teamNumber === 'Bye') return 'Bye';

  const normalizedTeamNumber = String(parseInt(teamNumber, 10) || teamNumber);

  const team = teamsData.find((t) => {
    const storedNumber = String(
      parseInt(String(t[teamNumberField]), 10) || t[teamNumberField],
    );
    const storedNumberAlt1 = String(
      parseInt(String(t['Team #']), 10) || t['Team #'],
    );
    const storedNumberAlt2 = String(
      parseInt(String(t['Team Number']), 10) || t['Team Number'],
    );
    const storedNumberAlt3 = String(
      parseInt(String(t['team_number']), 10) || t['team_number'],
    );

    return (
      storedNumber === normalizedTeamNumber ||
      storedNumberAlt1 === normalizedTeamNumber ||
      storedNumberAlt2 === normalizedTeamNumber ||
      storedNumberAlt3 === normalizedTeamNumber
    );
  });

  if (team) {
    return String(
      team[teamNameField] ||
        team['Team Name'] ||
        team['Name'] ||
        team['team_name'] ||
        team['display_name'] ||
        teamNumber,
    );
  }

  return teamNumber;
}

/** Truncate a team name and prefix it with the team number (display in brackets). */
export function formatBracketDisplay(
  teamNumber: string,
  teamName: string,
): string {
  if (!teamNumber || teamNumber === 'Bye') return 'Bye';
  const shortName = teamName.substring(0, 7);
  return `${teamNumber} ${shortName}`;
}
