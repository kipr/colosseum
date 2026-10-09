import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import SeedingDisplay from '../components/seeding/SeedingDisplay';
import BracketLikeView from '../components/bracket/BracketLikeView';
import BracketRankingView from '../components/bracket/BracketRankingView';
import DocumentationScoresDisplay from '../components/documentation/DocumentationScoresDisplay';
import OverallScoresDisplay from '../components/overall/OverallScoresDisplay';
import { getBracketWinner } from '../components/bracket/bracketUtils';
import {
  SEEDING_TABLE_CONFIG,
  DOUBLE_SEEDING_TABLE_CONFIG,
  type SeedingScore,
  type SeedingRanking,
  type DoubleSeedingScore,
  type DoubleSeedingRanking,
} from '../components/seeding/SeedingScoresTable';
import type { TeamSummary } from '../types/teams';
import type {
  Bracket,
  BracketEntryWithRank,
  BracketSide,
  BracketDetail,
} from '../types/brackets';
import type {
  DocCategoryDisplay,
  DocScoreDisplay,
} from '../components/documentation/DocumentationScoresDisplay';
import type { OverallRow } from '../components/overall/OverallScoresDisplay';
import {
  formatEventDate,
  getEventStatusClass,
  getEventStatusLabel,
} from '../utils/eventStatus';
import {
  spectatorEventPath,
  spectatorBracketPath,
  isSpectatorView,
  isSpectatorBracketView,
  isBracketSide,
  paramToBracketSide,
  bracketSideToParam,
} from '../utils/routes';
import { apiFetch } from '../utils/api';
import { useScopedLoad } from '../hooks/useScopedLoad';
import '../components/bracket/BracketDisplay.css';
import SpectatorAutomaticAwards, {
  hasAutomaticAwardsContent,
  type AutomaticAwardsPublic,
} from '../components/spectator/SpectatorAutomaticAwards';
import './SpectatorShared.css';
import './Spectator.css';
import './SpectatorTableLayout.css';
import { UnifiedTableScrollAffordanceProvider } from '../components/table';

interface PublicEvent {
  id: number;
  name: string;
  status: string;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
  double_seeding_rounds: number;
  final_scores_available: boolean;
}

interface PublicIndividualRecipient {
  name: string;
  team_number: number | null;
  team_name: string | null;
  display_name: string | null;
}

interface PublicManualAward {
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

interface PublicAwards {
  manual: PublicManualAward[];
  automatic: AutomaticAwardsPublic | null;
}

interface PublicBracketRankings {
  weight: number;
  entries: BracketEntryWithRank[];
}

type EffectiveTab =
  | 'seeding'
  | 'double-seeding'
  | 'bracket'
  | 'documentation'
  | 'awards'
  | 'bracketRankings'
  | 'overall';

export default function Spectator() {
  const navigate = useNavigate();
  const { eventId: eventIdParam, bracketId: bracketIdParam } = useParams<{
    eventId?: string;
    bracketId?: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const selectedEventId = eventIdParam ? Number(eventIdParam) : null;
  const selectedBracketId = bracketIdParam ? Number(bracketIdParam) : null;

  const viewParam = searchParams.get('view');
  const sideParam = searchParams.get('side');

  const bracketSide: BracketSide | undefined = isBracketSide(sideParam)
    ? paramToBracketSide(sideParam)
    : undefined;

  const handleSideChange = useCallback(
    (side: BracketSide) => {
      const next: Record<string, string> = { side: bracketSideToParam(side) };
      const currentView = searchParams.get('view');
      if (currentView) next.view = currentView;
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const activeTab: EffectiveTab = useMemo(() => {
    if (bracketIdParam) {
      if (isSpectatorBracketView(viewParam)) {
        return viewParam === 'rankings' ? 'bracketRankings' : 'bracket';
      }
      return 'bracket';
    }
    if (isSpectatorView(viewParam)) {
      return viewParam === 'bracket' ? 'bracket' : viewParam;
    }
    return 'seeding';
  }, [bracketIdParam, viewParam]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const finalScoresAvailable = selectedEvent?.final_scores_available ?? false;

  const effectiveRounds = useMemo(
    () =>
      selectedEvent && selectedEvent.seeding_rounds > 0
        ? selectedEvent.seeding_rounds
        : 3,
    [selectedEvent],
  );

  const doubleSeedingRounds = selectedEvent?.double_seeding_rounds ?? 0;
  const doubleSeedingAvailable = doubleSeedingRounds > 0;

  useEffect(() => {
    if (
      selectedEventId &&
      selectedEvent &&
      activeTab === 'double-seeding' &&
      !doubleSeedingAvailable
    ) {
      navigate(spectatorEventPath(selectedEventId, 'seeding'), {
        replace: true,
      });
    }
  }, [
    activeTab,
    doubleSeedingAvailable,
    navigate,
    selectedEvent,
    selectedEventId,
  ]);

  // If no eventId in URL, redirect to event selection page
  useEffect(() => {
    if (!eventIdParam) {
      navigate('/spectator', { replace: true });
    }
  }, [eventIdParam, navigate]);

  // Load public events list (for the selected event metadata)
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<PublicEvent[]>('/events/public', {
          fallbackError: 'Failed to fetch events',
        });
        setEvents(data);
      } catch (error) {
        console.error('Error loading events:', error);
      } finally {
        setEventsLoading(false);
      }
    })();
  }, []);

  // Redirect to /spectator if eventId is invalid after events load
  useEffect(() => {
    if (eventsLoading || !eventIdParam || events.length === 0) return;
    const exists = events.find((e) => e.id === Number(eventIdParam));
    if (!exists) {
      navigate('/spectator', { replace: true });
    }
  }, [eventsLoading, eventIdParam, events, navigate]);

  const logError = (what: string) => (error: unknown) =>
    console.error(`Error loading ${what}:`, error);

  const {
    data: { teams, scores, rankings },
    loading: seedingLoading,
  } = useScopedLoad(
    selectedEventId,
    async (eventId, signal) => {
      const [teams, scores, rankings] = await Promise.all([
        apiFetch<TeamSummary[]>(`/teams/event/${eventId}`, { signal }),
        apiFetch<SeedingScore[]>(`/seeding/scores/event/${eventId}`, {
          signal,
        }),
        apiFetch<SeedingRanking[]>(`/seeding/rankings/event/${eventId}`, {
          signal,
        }),
      ]);
      return { teams, scores, rankings };
    },
    {
      initial: { teams: [], scores: [], rankings: [] },
      onError: logError('seeding data'),
    },
  );

  const {
    data: { scores: doubleSeedingScores, rankings: doubleSeedingRankings },
    loading: doubleSeedingLoading,
  } = useScopedLoad(
    selectedEventId,
    async (eventId, signal) => {
      const [scores, rankings] = await Promise.all([
        apiFetch<DoubleSeedingScore[]>(
          `/double-seeding/scores/event/${eventId}`,
          { signal },
        ),
        apiFetch<DoubleSeedingRanking[]>(
          `/double-seeding/rankings/event/${eventId}`,
          { signal },
        ),
      ]);
      return { scores, rankings };
    },
    {
      initial: { scores: [], rankings: [] },
      enabled: activeTab === 'double-seeding',
      onError: logError('double-seeding data'),
    },
  );

  const { data: brackets } = useScopedLoad(
    selectedEventId,
    (eventId, signal) =>
      apiFetch<Bracket[]>(`/brackets/event/${eventId}`, {
        signal,
        fallbackError: 'Failed to fetch brackets',
      }),
    { initial: [], onError: logError('brackets') },
  );

  const { data: bracketGames, loading: bracketLoading } = useScopedLoad(
    selectedBracketId,
    async (bracketId, signal) => {
      const data = await apiFetch<BracketDetail>(`/brackets/${bracketId}`, {
        signal,
        fallbackError: 'Failed to fetch bracket',
      });
      return data.games ?? [];
    },
    { initial: [], onError: logError('bracket games') },
  );

  const {
    data: { categories: docCategories, scores: docScores },
    loading: docLoading,
  } = useScopedLoad(
    selectedEventId,
    (eventId, signal) =>
      apiFetch<{ categories: DocCategoryDisplay[]; scores: DocScoreDisplay[] }>(
        `/documentation-scores/event/${eventId}/public`,
        { signal },
      ),
    {
      initial: { categories: [], scores: [] },
      enabled: activeTab === 'documentation' && finalScoresAvailable,
      onError: logError('documentation scores'),
    },
  );

  const {
    data: { manual: manualAwards, automatic: automaticAwards },
    loading: awardsLoading,
  } = useScopedLoad<number, PublicAwards>(
    selectedEventId,
    async (eventId, signal) => {
      const data = await apiFetch<{
        manual: PublicManualAward[];
        automatic: AutomaticAwardsPublic;
      }>(`/awards/event/${eventId}/public`, { signal });
      return {
        manual: (data.manual ?? []).map((award) => ({
          ...award,
          recipients: award.recipients ?? [],
          individual_recipients: award.individual_recipients ?? [],
        })),
        automatic: data.automatic ?? null,
      };
    },
    {
      initial: { manual: [], automatic: null },
      enabled: activeTab === 'awards' && finalScoresAvailable,
      onError: logError('awards'),
    },
  );

  const { data: bracketRankingsData, loading: bracketRankingsLoading } =
    useScopedLoad<number, PublicBracketRankings | null>(
      selectedBracketId,
      (bracketId, signal) =>
        apiFetch<PublicBracketRankings>(
          `/brackets/${bracketId}/rankings/public`,
          { signal },
        ),
      {
        initial: null,
        enabled: activeTab === 'bracketRankings' && finalScoresAvailable,
        onError: logError('bracket rankings'),
      },
    );

  const { data: overallRows, loading: overallLoading } = useScopedLoad(
    selectedEventId,
    (eventId, signal) =>
      apiFetch<OverallRow[]>(`/events/${eventId}/overall/public`, { signal }),
    {
      initial: [],
      enabled: activeTab === 'overall' && finalScoresAvailable,
      onError: logError('overall scores'),
    },
  );

  const navigateToTab = useCallback(
    (tab: EffectiveTab) => {
      if (!selectedEventId) return;
      if (tab === 'bracket' || tab === 'bracketRankings') {
        const bid =
          selectedBracketId ?? (brackets.length > 0 ? brackets[0].id : null);
        if (bid) {
          navigate(
            spectatorBracketPath(
              selectedEventId,
              bid,
              tab === 'bracketRankings' ? 'rankings' : 'bracket',
            ),
          );
        }
      } else {
        navigate(spectatorEventPath(selectedEventId, tab));
      }
    },
    [selectedEventId, selectedBracketId, brackets, navigate],
  );

  const handleBracketChange = useCallback(
    (newBracketId: number) => {
      if (!selectedEventId) return;
      const view = activeTab === 'bracketRankings' ? 'rankings' : 'bracket';
      navigate(spectatorBracketPath(selectedEventId, newBracketId, view));
    },
    [selectedEventId, activeTab, navigate],
  );

  const winner = useMemo(
    () => (bracketGames.length > 0 ? getBracketWinner(bracketGames) : null),
    [bracketGames],
  );

  const bracketSelector = (idPrefix: string) =>
    brackets.length > 1 ? (
      <div className="spectator-bracket-selector">
        <label htmlFor={`${idPrefix}-bracket`}>Bracket</label>
        <select
          id={`${idPrefix}-bracket`}
          value={selectedBracketId ?? ''}
          onChange={(e) => handleBracketChange(Number(e.target.value))}
        >
          {brackets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  return (
    <div className="app">
      <Navbar />
      <main className="spectator-container spectator-shell-container">
        <UnifiedTableScrollAffordanceProvider>
          <div className="spectator-header">
            <h2>{selectedEvent ? selectedEvent.name : 'Spectator'}</h2>
            <p>View live seeding scores and bracket results.</p>
          </div>

          {eventsLoading ? (
            <p>Loading events...</p>
          ) : events.length === 0 ? (
            <div className="card">
              <p className="spectator-muted-message">
                No events are currently available.
              </p>
            </div>
          ) : (
            <>
              <div className="spectator-event-info">
                <button
                  className="spectator-back-btn"
                  onClick={() => navigate('/spectator')}
                >
                  ← All Events
                </button>
                {selectedEvent && (
                  <div className="spectator-event-meta spectator-status-cluster">
                    <span
                      className={`event-status-badge ${getEventStatusClass(selectedEvent.status)}`}
                    >
                      {getEventStatusLabel(selectedEvent.status)}
                    </span>
                    {selectedEvent.event_date && (
                      <span>{formatEventDate(selectedEvent.event_date)}</span>
                    )}
                    {selectedEvent.location && (
                      <span>{selectedEvent.location}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="spectator-tabs">
                <button
                  className={`spectator-tab-btn ${activeTab === 'seeding' ? 'active' : ''}`}
                  onClick={() => navigateToTab('seeding')}
                >
                  Seeding
                </button>
                {doubleSeedingAvailable && (
                  <button
                    className={`spectator-tab-btn ${activeTab === 'double-seeding' ? 'active' : ''}`}
                    onClick={() => navigateToTab('double-seeding')}
                  >
                    Double Seeding
                  </button>
                )}
                <button
                  className={`spectator-tab-btn ${activeTab === 'bracket' ? 'active' : ''}`}
                  onClick={() => navigateToTab('bracket')}
                >
                  Bracket
                </button>
                {finalScoresAvailable && (
                  <>
                    <button
                      className={`spectator-tab-btn ${activeTab === 'documentation' ? 'active' : ''}`}
                      onClick={() => navigateToTab('documentation')}
                    >
                      Documentation
                    </button>
                    <button
                      className={`spectator-tab-btn ${activeTab === 'awards' ? 'active' : ''}`}
                      onClick={() => navigateToTab('awards')}
                    >
                      Awards
                    </button>
                    <button
                      className={`spectator-tab-btn ${activeTab === 'bracketRankings' ? 'active' : ''}`}
                      onClick={() => navigateToTab('bracketRankings')}
                    >
                      Bracket Rankings
                    </button>
                    <button
                      className={`spectator-tab-btn ${activeTab === 'overall' ? 'active' : ''}`}
                      onClick={() => navigateToTab('overall')}
                    >
                      Overall
                    </button>
                  </>
                )}
              </div>

              {activeTab === 'seeding' && (
                <div className="spectator-seeding-view">
                  {seedingLoading ? (
                    <p>Loading seeding data...</p>
                  ) : (
                    <SeedingDisplay
                      teams={teams}
                      scores={scores}
                      rankings={rankings}
                      effectiveRounds={effectiveRounds}
                      config={SEEDING_TABLE_CONFIG}
                      variant="spectator"
                    />
                  )}
                </div>
              )}

              {activeTab === 'double-seeding' && doubleSeedingAvailable && (
                <div className="spectator-seeding-view">
                  {doubleSeedingLoading ? (
                    <p>Loading double-seeding data...</p>
                  ) : (
                    <SeedingDisplay
                      teams={teams}
                      scores={doubleSeedingScores}
                      rankings={doubleSeedingRankings}
                      effectiveRounds={doubleSeedingRounds}
                      config={DOUBLE_SEEDING_TABLE_CONFIG}
                      variant="spectator"
                    />
                  )}
                </div>
              )}

              {activeTab === 'bracket' && (
                <div>
                  {brackets.length === 0 ? (
                    <div className="card">
                      <p className="spectator-muted-message">
                        No brackets available for this event.
                      </p>
                    </div>
                  ) : (
                    <>
                      {bracketSelector('spectator')}

                      {bracketLoading ? (
                        <p>Loading bracket...</p>
                      ) : (
                        <div className="card bracket-section">
                          {winner && (
                            <div className="bracket-winner-banner bracket-winner-bracket-view">
                              <span
                                className="bracket-winner-trophy"
                                aria-hidden
                              >
                                🏆
                              </span>
                              <span className="bracket-winner-label">
                                Champion
                              </span>
                              <span className="bracket-winner-team">
                                <strong>{winner.team_number}</strong>{' '}
                                {winner.team_name ||
                                  winner.team_display ||
                                  `Team ${winner.team_id}`}
                              </span>
                            </div>
                          )}
                          <BracketLikeView
                            games={bracketGames}
                            side={bracketSide}
                            onSideChange={handleSideChange}
                            emptyMessage="No bracket games available yet."
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'documentation' && finalScoresAvailable && (
                <div>
                  {docLoading ? (
                    <p>Loading documentation scores...</p>
                  ) : (
                    <div className="spectator-documentation-view">
                      <DocumentationScoresDisplay
                        categories={docCategories}
                        scores={docScores}
                        variant="spectator"
                      />
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'awards' && finalScoresAvailable && (
                <div>
                  {awardsLoading ? (
                    <p>Loading awards...</p>
                  ) : manualAwards.length === 0 &&
                    !hasAutomaticAwardsContent(automaticAwards) ? (
                    <div className="card">
                      <p className="spectator-muted-message">
                        No awards have been published for this event.
                      </p>
                    </div>
                  ) : (
                    <div className="card">
                      <h3 className="spectator-awards-title">Awards</h3>
                      {automaticAwards &&
                        hasAutomaticAwardsContent(automaticAwards) && (
                          <SpectatorAutomaticAwards
                            automatic={automaticAwards}
                          />
                        )}
                      {manualAwards.length > 0 && (
                        <div
                          className={`spectator-manual-awards${hasAutomaticAwardsContent(automaticAwards) ? ' spectator-manual-awards-with-automatic' : ''}`}
                        >
                          {hasAutomaticAwardsContent(automaticAwards) && (
                            <h4 className="spectator-awards-subtitle">
                              Other awards
                            </h4>
                          )}
                          {manualAwards.map((award, idx) => (
                            <div
                              key={idx}
                              className="spectator-manual-award"
                              data-has-divider={idx < manualAwards.length - 1}
                            >
                              <strong className="spectator-manual-award-title">
                                {award.name}
                              </strong>
                              {award.description && (
                                <p className="spectator-manual-award-description">
                                  {award.description}
                                </p>
                              )}
                              {award.recipients.length > 0 ||
                              award.individual_recipients.length > 0 ? (
                                <ul className="spectator-manual-award-recipients">
                                  {award.recipients.map((r, ri) => (
                                    <li
                                      key={`team-${r.team_number}-${ri}`}
                                      className="spectator-manual-award-recipient"
                                    >
                                      <strong>#{r.team_number}</strong>{' '}
                                      <span className="spectator-manual-award-recipient-name">
                                        {r.display_name?.trim()
                                          ? r.display_name
                                          : r.team_name}
                                      </span>
                                    </li>
                                  ))}
                                  {award.individual_recipients.map((r, ri) => {
                                    const teamLabel =
                                      r.team_number != null
                                        ? `#${r.team_number} ${
                                            r.display_name?.trim()
                                              ? r.display_name
                                              : (r.team_name ?? '')
                                          }`.trim()
                                        : null;
                                    return (
                                      <li
                                        key={`individual-${r.name}-${r.team_number ?? 'none'}-${ri}`}
                                        className="spectator-manual-award-recipient"
                                      >
                                        <span className="spectator-manual-award-recipient-name">
                                          {r.name}
                                        </span>
                                        {teamLabel && (
                                          <span className="spectator-manual-award-recipient-team">
                                            {' '}
                                            · {teamLabel}
                                          </span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                <p className="spectator-manual-award-empty">
                                  No recipients
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'bracketRankings' && finalScoresAvailable && (
                <div className="spectator-bracket-rankings-view">
                  {brackets.length === 0 ? (
                    <div className="card">
                      <p className="spectator-muted-message">
                        No brackets available for this event.
                      </p>
                    </div>
                  ) : (
                    <>
                      {bracketSelector('spectator-rankings')}
                      <BracketRankingView
                        bracketId={selectedBracketId ?? 0}
                        rankings={bracketRankingsData?.entries ?? null}
                        weight={bracketRankingsData?.weight ?? 1}
                        loading={bracketRankingsLoading}
                        variant="spectator"
                      />
                    </>
                  )}
                </div>
              )}

              {activeTab === 'overall' && finalScoresAvailable && (
                <div className="spectator-overall-view">
                  {overallLoading ? (
                    <p>Loading overall scores...</p>
                  ) : (
                    <OverallScoresDisplay
                      rows={overallRows}
                      variant="spectator"
                      showDoubleSeeding={doubleSeedingAvailable}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </UnifiedTableScrollAffordanceProvider>
      </main>
    </div>
  );
}
