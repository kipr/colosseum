export const ADMIN_VIEWS = [
  'events',
  'teams',
  'scoresheets',
  'scoring',
  'seeding',
  'brackets',
  'queue',
  'documentation',
  'awards',
  'overall',
  'admins',
  'audit',
] as const;

export type AdminView = (typeof ADMIN_VIEWS)[number];

export const SPECTATOR_VIEWS = [
  'seeding',
  'bracket',
  'documentation',
  'awards',
  'overall',
] as const;

export type SpectatorView = (typeof SPECTATOR_VIEWS)[number];

export const BRACKET_DETAIL_VIEWS = [
  'bracket',
  'ranking',
  'management',
] as const;

export type BracketDetailView = (typeof BRACKET_DETAIL_VIEWS)[number];

export const SPECTATOR_BRACKET_VIEWS = ['bracket', 'rankings'] as const;

export type SpectatorBracketView = (typeof SPECTATOR_BRACKET_VIEWS)[number];

export const BRACKET_SIDES = ['winners', 'losers', 'finals'] as const;

export type BracketSideParam = (typeof BRACKET_SIDES)[number];

export function isAdminView(v: string | null | undefined): v is AdminView {
  return ADMIN_VIEWS.includes(v as AdminView);
}

export function isSpectatorView(
  v: string | null | undefined,
): v is SpectatorView {
  return SPECTATOR_VIEWS.includes(v as SpectatorView);
}

export function isBracketDetailView(
  v: string | null | undefined,
): v is BracketDetailView {
  return BRACKET_DETAIL_VIEWS.includes(v as BracketDetailView);
}

export function isSpectatorBracketView(
  v: string | null | undefined,
): v is SpectatorBracketView {
  return SPECTATOR_BRACKET_VIEWS.includes(v as SpectatorBracketView);
}

export function isBracketSide(
  v: string | null | undefined,
): v is BracketSideParam {
  return BRACKET_SIDES.includes(v as BracketSideParam);
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
}

export function adminEventsPath(view?: AdminView): string {
  return '/admin/events' + qs({ view });
}

export function adminEventPath(
  eventId: number | string,
  view?: AdminView,
): string {
  return `/admin/events/${eventId}` + qs({ view });
}

export function adminBracketPath(
  eventId: number | string,
  bracketId: number | string,
  view?: BracketDetailView,
  side?: BracketSideParam,
): string {
  return `/admin/events/${eventId}/brackets/${bracketId}` + qs({ view, side });
}

export function spectatorEventPath(
  eventId: number | string,
  view?: SpectatorView,
): string {
  return `/spectator/events/${eventId}` + qs({ view });
}

export function spectatorBracketPath(
  eventId: number | string,
  bracketId: number | string,
  view?: SpectatorBracketView,
  side?: BracketSideParam,
): string {
  return (
    `/spectator/events/${eventId}/brackets/${bracketId}` + qs({ view, side })
  );
}
