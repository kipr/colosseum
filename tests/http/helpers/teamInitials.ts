import {
  buildTeamInitialsScoreEntries,
  getRequiredTeamInitialsSlots,
  SEEDING_TEAM_INITIALS_ID,
  TEAM_A_INITIALS_ID,
  TEAM_B_INITIALS_ID,
  type EventScoreType,
} from '../../../src/shared/teamInitials';

export function withTeamInitials(
  scoreData: Record<string, unknown>,
  scoreType: EventScoreType,
  options: { hasTeamB?: boolean; teamA?: string; teamB?: string } = {},
): Record<string, unknown> {
  const slots = getRequiredTeamInitialsSlots({
    scoreType,
    hasTeamB: options.hasTeamB,
  });
  return {
    ...scoreData,
    ...buildTeamInitialsScoreEntries(
      {
        [SEEDING_TEAM_INITIALS_ID]: options.teamA ?? 'TA',
        [TEAM_A_INITIALS_ID]: options.teamA ?? 'TA',
        [TEAM_B_INITIALS_ID]: options.teamB ?? 'TB',
      },
      slots,
    ),
  };
}
