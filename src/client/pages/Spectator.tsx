import { useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import SeedingDisplay from '../components/seeding/SeedingDisplay';
import DoubleSeedingDisplay from '../components/doubleSeeding/DoubleSeedingDisplay';
import type {
  DoubleSeedingScore,
  DoubleSeedingRanking,
} from '../components/doubleSeeding/DoubleSeedingScoresTable';
import BracketLikeView from '../components/bracket/BracketLikeView';
import BracketRankingView from '../components/bracket/BracketRankingView';
import DocumentationScoresDisplay from '../components/documentation/DocumentationScoresDisplay';
import OverallScoresDisplay from '../components/overall/OverallScoresDisplay';
import { getBracketWinner } from '../components/bracket/bracketUtils';
import type {
  Team,
  SeedingScore,
  SeedingRanking,
} from '../components/seeding/SeedingScoresTable';
import type { Bracket, BracketGame, BracketSide } from '../types/brackets';
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
import '../components/bracket/BracketDisplay.css';
import SpectatorAutomaticAwards, {
  hasAutomaticAwardsContent,
} from '../components/spectator/SpectatorAutomaticAwards';
import './SpectatorShared.css';
import './Spectator.css';
import './SpectatorTableLayout.css';
import { UnifiedTableScrollAffordanceProvider } from '../components/table';
import type { PublicEvent } from '../api/types';
import type { PublicManualAward } from '../api/awards';
import {
  publicEventsQueryOptions,
  publicOverallQueryOptions,
} from '../queries/events';
import { publicTeamsQueryOptions } from '../queries/teams';
import {
  publicSeedingRankingsQueryOptions,
  publicSeedingScoresQueryOptions,
} from '../queries/seeding';
import {
  publicDoubleSeedingRankingsQueryOptions,
  publicDoubleSeedingScoresQueryOptions,
} from '../queries/doubleSeeding';
import {
  publicBracketQueryOptions,
  publicBracketRankingsQueryOptions,
  publicBracketsQueryOptions,
} from '../queries/brackets';
import { publicDocumentationQueryOptions } from '../queries/documentation';
import { publicAwardsQueryOptions } from '../queries/awards';
import { removeRestrictedPublicResults } from '../queries/invalidation';
import { queryData } from '../components/QueryFeedback';

type EffectiveTab =
  | 'seeding'
  | 'double-seeding'
  | 'bracket'
  | 'documentation'
  | 'awards'
  | 'bracketRankings'
  | 'overall';

const EMPTY_EVENTS: PublicEvent[] = [];
const EMPTY_TEAMS: Team[] = [];
const EMPTY_SCORES: SeedingScore[] = [];
const EMPTY_RANKINGS: SeedingRanking[] = [];
const EMPTY_DS_SCORES: DoubleSeedingScore[] = [];
const EMPTY_DS_RANKINGS: DoubleSeedingRanking[] = [];
const EMPTY_BRACKETS: Bracket[] = [];
const EMPTY_GAMES: BracketGame[] = [];
const EMPTY_OVERALL: OverallRow[] = [];
const EMPTY_MANUAL_AWARDS: PublicManualAward[] = [];

export default function Spectator() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { eventId: eventIdParam, bracketId: bracketIdParam } = useParams<{
    eventId?: string;
    bracketId?: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();

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

  const eventsQuery = useQuery(publicEventsQueryOptions());
  const events = eventsQuery.data ?? EMPTY_EVENTS;
  const eventsLoading = eventsQuery.isLoading;

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
  const eventReady = Boolean(selectedEventId && selectedEvent);
  const restrictedEnabled = eventReady && finalScoresAvailable;

  useEffect(() => {
    if (selectedEvent && !selectedEvent.final_scores_available) {
      void removeRestrictedPublicResults(queryClient, selectedEvent.id);
    }
  }, [queryClient, selectedEvent]);

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

  useEffect(() => {
    if (!eventIdParam) {
      navigate('/spectator', { replace: true });
    }
  }, [eventIdParam, navigate]);

  useEffect(() => {
    if (!eventsQuery.isSuccess || !eventIdParam || events.length === 0) return;
    const exists = events.find((e) => e.id === Number(eventIdParam));
    if (!exists) {
      navigate('/spectator', { replace: true });
    }
  }, [eventsQuery.isSuccess, eventIdParam, events, navigate]);

  const teamsQuery = useQuery({
    ...publicTeamsQueryOptions(selectedEventId ?? 0),
    enabled: eventReady,
  });
  const seedingScoresQuery = useQuery({
    ...publicSeedingScoresQueryOptions(selectedEventId ?? 0),
    enabled: eventReady,
  });
  const seedingRankingsQuery = useQuery({
    ...publicSeedingRankingsQueryOptions(selectedEventId ?? 0),
    enabled: eventReady,
  });
  const teams = queryData(teamsQuery) ?? EMPTY_TEAMS;
  const scores = queryData(seedingScoresQuery) ?? EMPTY_SCORES;
  const rankings = queryData(seedingRankingsQuery) ?? EMPTY_RANKINGS;
  const seedingLoading =
    teamsQuery.isLoading ||
    seedingScoresQuery.isLoading ||
    seedingRankingsQuery.isLoading;

  const dsEnabled =
    eventReady && activeTab === 'double-seeding' && doubleSeedingAvailable;
  const dsScoresQuery = useQuery({
    ...publicDoubleSeedingScoresQueryOptions(selectedEventId ?? 0),
    enabled: dsEnabled,
  });
  const dsRankingsQuery = useQuery({
    ...publicDoubleSeedingRankingsQueryOptions(selectedEventId ?? 0),
    enabled: dsEnabled,
  });
  const doubleSeedingScores = queryData(dsScoresQuery) ?? EMPTY_DS_SCORES;
  const doubleSeedingRankings = queryData(dsRankingsQuery) ?? EMPTY_DS_RANKINGS;
  const doubleSeedingLoading =
    dsScoresQuery.isLoading || dsRankingsQuery.isLoading;

  const bracketsQuery = useQuery({
    ...publicBracketsQueryOptions(selectedEventId ?? 0),
    enabled: eventReady,
  });
  const brackets = queryData(bracketsQuery) ?? EMPTY_BRACKETS;
  const bracketDetailQuery = useQuery({
    ...publicBracketQueryOptions(selectedEventId ?? 0, selectedBracketId ?? 0),
    enabled: eventReady && selectedBracketId != null,
  });
  const bracketGames = queryData(bracketDetailQuery)?.games ?? EMPTY_GAMES;
  const bracketLoading = bracketDetailQuery.isLoading;

  const docsQuery = useQuery({
    ...publicDocumentationQueryOptions(selectedEventId ?? 0),
    enabled: restrictedEnabled && activeTab === 'documentation',
  });
  const docCategories = restrictedEnabled
    ? (queryData(docsQuery)?.categories ?? [])
    : [];
  const docScores = restrictedEnabled
    ? (queryData(docsQuery)?.scores ?? [])
    : [];
  const docLoading = docsQuery.isLoading;

  const awardsQuery = useQuery({
    ...publicAwardsQueryOptions(selectedEventId ?? 0),
    enabled: restrictedEnabled && activeTab === 'awards',
  });
  const publicAwards = restrictedEnabled ? queryData(awardsQuery) : undefined;
  const manualAwards = publicAwards?.manual ?? EMPTY_MANUAL_AWARDS;
  const automaticAwards = publicAwards?.automatic ?? null;
  const awardsLoading = awardsQuery.isLoading;

  const bracketRankingsQuery = useQuery({
    ...publicBracketRankingsQueryOptions(
      selectedEventId ?? 0,
      selectedBracketId ?? 0,
    ),
    enabled:
      restrictedEnabled &&
      activeTab === 'bracketRankings' &&
      selectedBracketId != null,
  });
  const bracketRankingsData = restrictedEnabled
    ? queryData(bracketRankingsQuery)
    : undefined;
  const bracketRankings = bracketRankingsData?.entries ?? null;
  const bracketRankingsWeight = bracketRankingsData?.weight ?? 1;
  const bracketRankingsLoading = bracketRankingsQuery.isLoading;

  const overallQuery = useQuery({
    ...publicOverallQueryOptions(selectedEventId ?? 0),
    enabled: restrictedEnabled && activeTab === 'overall',
  });
  const overallRows = restrictedEnabled
    ? (queryData(overallQuery) ?? EMPTY_OVERALL)
    : EMPTY_OVERALL;
  const overallLoading = overallQuery.isLoading;

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
                    <DoubleSeedingDisplay
                      teams={teams}
                      scores={doubleSeedingScores}
                      rankings={doubleSeedingRankings}
                      effectiveRounds={doubleSeedingRounds}
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
                        rankings={bracketRankings}
                        weight={bracketRankingsWeight}
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
