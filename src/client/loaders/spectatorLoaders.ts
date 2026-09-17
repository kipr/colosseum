import {
  redirect,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunctionArgs,
} from 'react-router-dom';
import type {
  DoubleSeedingRanking,
  DoubleSeedingScore,
} from '../components/doubleSeeding/DoubleSeedingScoresTable';
import type {
  DocCategoryDisplay,
  DocScoreDisplay,
} from '../components/documentation/DocumentationScoresDisplay';
import type { OverallRow } from '../components/overall/OverallScoresDisplay';
import type {
  SeedingRanking,
  SeedingScore,
  Team,
} from '../components/seeding/SeedingScoresTable';
import type { AutomaticAwardsPublic } from '../components/spectator/SpectatorAutomaticAwards';
import type {
  Bracket,
  BracketDetail,
  BracketEntryWithRank,
} from '../types/brackets';
import {
  isBracketSide,
  spectatorBracketPath,
  spectatorEventPath,
  type SpectatorEventView,
} from '../utils/routes';

export interface PublicEvent {
  id: number;
  name: string;
  status: string;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
  double_seeding_rounds: number;
  final_scores_available: boolean;
}

export interface SpectatorEventLoaderData {
  event: PublicEvent;
  brackets: Bracket[];
}

export interface SpectatorSeedingLoaderData {
  teams: Team[];
  scores: SeedingScore[];
  rankings: SeedingRanking[];
}

export interface SpectatorDoubleSeedingLoaderData {
  teams: Team[];
  scores: DoubleSeedingScore[];
  rankings: DoubleSeedingRanking[];
}

export interface SpectatorDocumentationLoaderData {
  categories: DocCategoryDisplay[];
  scores: DocScoreDisplay[];
}

export interface PublicIndividualRecipient {
  name: string;
  team_number: number | null;
  team_name: string | null;
  display_name: string | null;
}

export interface PublicManualAward {
  name: string;
  description: string | null;
  sort_order: number;
  recipients: {
    team_number: number;
    team_name: string;
    display_name?: string | null;
  }[];
  individual_recipients: PublicIndividualRecipient[];
}

export interface SpectatorAwardsLoaderData {
  manual: PublicManualAward[];
  automatic: AutomaticAwardsPublic | null;
}

export interface SpectatorBracketRankingsLoaderData {
  entries: BracketEntryWithRank[];
  weight: number;
}

function notFound(message: string): Response {
  return new Response(message, { status: 404, statusText: 'Not Found' });
}

function parseId(value: string | undefined, label: string): number {
  if (!value || !/^\d+$/.test(value)) throw notFound(`${label} not found.`);

  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    throw notFound(`${label} not found.`);
  }
  return id;
}

async function fetchJson<T>(
  url: string,
  signal: AbortSignal,
  missingMessage: string,
): Promise<T> {
  const response = await fetch(url, { signal });
  if (response.status === 404) throw notFound(missingMessage);
  if (!response.ok) throw response;
  return (await response.json()) as T;
}

async function loadPublicEvent(
  eventId: number,
  signal: AbortSignal,
): Promise<PublicEvent> {
  return fetchJson<PublicEvent>(
    `/events/${eventId}/public`,
    signal,
    'Event not found.',
  );
}

async function requireReleasedEvent(
  eventId: number,
  signal: AbortSignal,
): Promise<PublicEvent> {
  const event = await loadPublicEvent(eventId, signal);
  if (!event.final_scores_available) {
    throw redirect(spectatorEventPath(eventId, 'seeding'));
  }
  return event;
}

export async function spectatorEventsLoader({
  request,
}: LoaderFunctionArgs): Promise<PublicEvent[]> {
  return fetchJson<PublicEvent[]>(
    '/events/public',
    request.signal,
    'No events found.',
  );
}

export async function spectatorEventLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<SpectatorEventLoaderData> {
  const eventId = parseId(params.eventId, 'Event');
  const [event, brackets] = await Promise.all([
    loadPublicEvent(eventId, request.signal),
    fetchJson<Bracket[]>(
      `/brackets/event/${eventId}`,
      request.signal,
      'Event not found.',
    ),
  ]);
  return { event, brackets };
}

const LEGACY_EVENT_VIEWS: Record<string, SpectatorEventView> = {
  seeding: 'seeding',
  'double-seeding': 'double-seeding',
  documentation: 'documentation',
  awards: 'awards',
  overall: 'overall',
};

export function spectatorEventIndexLoader({
  params,
  request,
}: LoaderFunctionArgs) {
  const eventId = parseId(params.eventId, 'Event');
  const view = new URL(request.url).searchParams.get('view');
  if (view === 'bracket') {
    return redirect(spectatorEventPath(eventId, 'brackets'));
  }
  return redirect(
    spectatorEventPath(eventId, LEGACY_EVENT_VIEWS[view ?? ''] ?? 'seeding'),
  );
}

export async function spectatorSeedingLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<SpectatorSeedingLoaderData> {
  const eventId = parseId(params.eventId, 'Event');
  const [teams, scores, rankings] = await Promise.all([
    fetchJson<Team[]>(
      `/teams/event/${eventId}`,
      request.signal,
      'Event not found.',
    ),
    fetchJson<SeedingScore[]>(
      `/seeding/scores/event/${eventId}`,
      request.signal,
      'Event not found.',
    ),
    fetchJson<SeedingRanking[]>(
      `/seeding/rankings/event/${eventId}`,
      request.signal,
      'Event not found.',
    ),
  ]);
  return { teams, scores, rankings };
}

export async function spectatorDoubleSeedingLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<SpectatorDoubleSeedingLoaderData> {
  const eventId = parseId(params.eventId, 'Event');
  const event = await loadPublicEvent(eventId, request.signal);
  if (event.double_seeding_rounds <= 0) {
    throw redirect(spectatorEventPath(eventId, 'seeding'));
  }

  const [teams, scores, rankings] = await Promise.all([
    fetchJson<Team[]>(
      `/teams/event/${eventId}`,
      request.signal,
      'Event not found.',
    ),
    fetchJson<DoubleSeedingScore[]>(
      `/double-seeding/scores/event/${eventId}`,
      request.signal,
      'Event not found.',
    ),
    fetchJson<DoubleSeedingRanking[]>(
      `/double-seeding/rankings/event/${eventId}`,
      request.signal,
      'Event not found.',
    ),
  ]);
  return { teams, scores, rankings };
}

export async function spectatorBracketIndexLoader({
  params,
  request,
}: LoaderFunctionArgs) {
  const eventId = parseId(params.eventId, 'Event');
  const brackets = await fetchJson<Bracket[]>(
    `/brackets/event/${eventId}`,
    request.signal,
    'Event not found.',
  );
  if (brackets.length > 0) {
    throw redirect(spectatorBracketPath(eventId, brackets[0].id, 'bracket'));
  }
  return null;
}

function legacyBracketRedirect(
  eventId: number,
  bracketId: number,
  request: Request,
): Response | null {
  const url = new URL(request.url);
  const view = url.searchParams.get('view');
  if (view === null) return null;

  const side = url.searchParams.get('side');
  return redirect(
    spectatorBracketPath(
      eventId,
      bracketId,
      view === 'rankings' ? 'rankings' : 'bracket',
      isBracketSide(side) ? side : undefined,
    ),
  );
}

export async function spectatorBracketLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<BracketDetail> {
  const eventId = parseId(params.eventId, 'Event');
  const bracketId = parseId(params.bracketId, 'Bracket');
  const legacyRedirect = legacyBracketRedirect(eventId, bracketId, request);
  if (legacyRedirect) throw legacyRedirect;

  const bracket = await fetchJson<BracketDetail>(
    `/brackets/${bracketId}`,
    request.signal,
    'Bracket not found.',
  );
  if (bracket.event_id !== eventId) throw notFound('Bracket not found.');
  return bracket;
}

export async function spectatorBracketRankingsLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<SpectatorBracketRankingsLoaderData> {
  const eventId = parseId(params.eventId, 'Event');
  const bracketId = parseId(params.bracketId, 'Bracket');
  await requireReleasedEvent(eventId, request.signal);
  return fetchJson<SpectatorBracketRankingsLoaderData>(
    `/brackets/${bracketId}/rankings/public`,
    request.signal,
    'Bracket rankings not found.',
  );
}

export async function spectatorDocumentationLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<SpectatorDocumentationLoaderData> {
  const eventId = parseId(params.eventId, 'Event');
  await requireReleasedEvent(eventId, request.signal);
  return fetchJson<SpectatorDocumentationLoaderData>(
    `/documentation-scores/event/${eventId}/public`,
    request.signal,
    'Documentation scores not found.',
  );
}

export async function spectatorAwardsLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<SpectatorAwardsLoaderData> {
  const eventId = parseId(params.eventId, 'Event');
  await requireReleasedEvent(eventId, request.signal);
  const data = await fetchJson<{
    manual?: PublicManualAward[];
    automatic?: AutomaticAwardsPublic | null;
  }>(`/awards/event/${eventId}/public`, request.signal, 'Awards not found.');
  return {
    manual: (data.manual ?? []).map((award) => ({
      ...award,
      recipients: award.recipients ?? [],
      individual_recipients: award.individual_recipients ?? [],
    })),
    automatic: data.automatic ?? null,
  };
}

export async function spectatorOverallLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<OverallRow[]> {
  const eventId = parseId(params.eventId, 'Event');
  await requireReleasedEvent(eventId, request.signal);
  return fetchJson<OverallRow[]>(
    `/events/${eventId}/overall/public`,
    request.signal,
    'Overall scores not found.',
  );
}

export function spectatorShouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;

  const currentSearch = new URLSearchParams(currentUrl.search);
  const nextSearch = new URLSearchParams(nextUrl.search);
  currentSearch.delete('side');
  nextSearch.delete('side');
  if (currentSearch.toString() === nextSearch.toString()) return false;

  return defaultShouldRevalidate;
}
