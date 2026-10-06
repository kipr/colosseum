import {
  TEAM_INITIALS_FORMAT_HINT,
  isTeamInitialsSide,
  isValidTeamInitials,
  normalizeTeamInitials,
  type TeamInitialsSide,
} from '../../shared/teamInitials';

/** A team the server expects to initial, resolved from the game/match/queue. */
export interface ExpectedTeamInitials {
  side: TeamInitialsSide;
  teamId: number;
}

export interface CheckedTeamInitials extends ExpectedTeamInitials {
  initials: string;
}

export type TeamInitialsCheck =
  | { ok: true; entries: CheckedTeamInitials[] }
  | { ok: false; error: string };

/** Participating sides for a two-team game or match (team1 → A, team2 → B). */
export function expectedTwoSidedInitials(
  team1Id: number | null | undefined,
  team2Id: number | null | undefined,
): ExpectedTeamInitials[] {
  const expected: ExpectedTeamInitials[] = [];
  if (team1Id != null) expected.push({ side: 'team_a', teamId: team1Id });
  if (team2Id != null) expected.push({ side: 'team_b', teamId: team2Id });
  return expected;
}

/**
 * Match the submitted initials against the teams the server expects.
 * Every expected side needs valid initials and nothing else may be sent, so a
 * client cannot skip a team or attach initials to one that is not playing.
 * `describeTeam` names the team in error messages.
 */
export function checkTeamInitials(
  expected: readonly ExpectedTeamInitials[],
  submitted: unknown,
  describeTeam: (teamId: number) => string,
): TeamInitialsCheck {
  if (
    submitted !== undefined &&
    submitted !== null &&
    !Array.isArray(submitted)
  ) {
    return { ok: false, error: 'teamInitials must be an array' };
  }

  const bySide = new Map<TeamInitialsSide, string>();
  for (const entry of submitted ?? []) {
    const side = (entry as { side?: unknown } | null)?.side;
    if (!isTeamInitialsSide(side)) {
      return {
        ok: false,
        error: `Unknown team initials side: ${String(side)}`,
      };
    }
    if (bySide.has(side)) {
      return {
        ok: false,
        error: `Team initials were submitted more than once for ${side}`,
      };
    }
    bySide.set(
      side,
      normalizeTeamInitials((entry as { initials?: unknown }).initials),
    );
  }

  for (const side of bySide.keys()) {
    if (!expected.some((participant) => participant.side === side)) {
      return {
        ok: false,
        error: `Team initials were submitted for ${side}, which has no team in this match`,
      };
    }
  }

  const entries: CheckedTeamInitials[] = [];
  for (const participant of expected) {
    const initials = bySide.get(participant.side);
    if (!initials) {
      return {
        ok: false,
        error: `Team initials are required for ${describeTeam(participant.teamId)}`,
      };
    }
    if (!isValidTeamInitials(initials)) {
      return {
        ok: false,
        error: `Team initials for ${describeTeam(participant.teamId)} must be ${TEAM_INITIALS_FORMAT_HINT}`,
      };
    }
    entries.push({ ...participant, initials });
  }

  return { ok: true, entries };
}
