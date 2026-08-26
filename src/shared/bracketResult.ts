export const BRACKET_RESULT_TYPES = [
  'standard',
  'no_contest',
  'disqualification',
] as const;

export type BracketResultType = (typeof BRACKET_RESULT_TYPES)[number];

export function getBracketResultLabel(resultType: BracketResultType): string {
  switch (resultType) {
    case 'no_contest':
      return 'No contest';
    case 'disqualification':
      return 'Disqualification';
    default:
      return 'Standard';
  }
}
