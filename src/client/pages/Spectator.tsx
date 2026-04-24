import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import SeedingDisplay from '../components/seeding/SeedingDisplay';
import BracketLikeView from '../components/bracket/BracketLikeView';
import BracketRankingView from '../components/bracket/BracketRankingView';
import DocumentationScoresDisplay from '../components/documentation/DocumentationScoresDisplay';
import OverallScoresDisplay from '../components/overall/OverallScoresDisplay';
import { getBracketWinner } from '../components/bracket/bracketUtils';
import type { Team } from '../../shared/domain';
import type { SeedingScore, SeedingRanking } from '../../shared/api';
import type {
  Bracket,
  BracketGame,
  BracketEntryWithRank,
  BracketSide,
} from '../types/brackets';
import type {
  OverallScoreRow,
  PublicDocumentationCategory,
  PublicDocumentationScore,
  PublicDocumentationScores,
} from '../../shared/api';
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
import type {
  AutomaticAwardsPublic,
  PublicEvent,
  PublicEventAwardsResponse,
  PublicManualAward,
} from '../../shared/api';
import './SpectatorShared.css';
import './Spectator.css';
import './SpectatorTableLayout.css';
import { UnifiedTableScrollAffordanceProvider } from '../components/table';

type EffectiveTab =
  | 'seeding'
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

  const [events, setEvents] = useState<readonly PublicEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  // Seeding state
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<SeedingScore[]>([]);
  const [rankings, setRankings] = useState<SeedingRanking[]>([]);
  const [seedingLoading, setSeedingLoading] = useState(false);

  // Bracket state
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [bracketGames, setBracketGames] = useState<BracketGame[]>([]);
  const [bracketLoading, setBracketLoading] = useState(false);

  // Documentation state (lazy-loaded)
  const [docCategories, setDocCategories] = useState<
    readonly PublicDocumentationCategory[]
  >([]);
  const [docScores, setDocScores] = useState<
    readonly PublicDocumentationScore[]
  >([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docLoaded, setDocLoaded] = useState(false);

  // Bracket rankings state (lazy-loaded)
  const [bracketRankings, setBracketRankings] = useState<
    BracketEntryWithRank[] | null
  >(null);
  const [bracketRankingsWeight, setBracketRankingsWeight] = useState(1);
  const [bracketRankingsLoading, setBracketRankingsLoading] = useState(false);
  const [bracketRankingsLoadedForId, setBracketRankingsLoadedForId] = useState<
    number | null
  >(null);

  // Awards state (lazy-loaded)
  const [manualAwards, setManualAwards] = useState<
    readonly PublicManualAward[]
  >([]);
  const [automaticAwards, setAutomaticAwards] =
    useState<AutomaticAwardsPublic | null>(null);
  const [awardsLoading, setAwardsLoading] = useState(false);
  const [awardsLoaded, setAwardsLoaded] = useState(false);

  // Overall state (lazy-loaded)
  const [overallRows, setOverallRows] = useState<readonly OverallScoreRow[]>(
    [],
  );
  const [overallLoading, setOverallLoading] = useState(false);
  const [overallLoaded, setOverallLoaded] = useState(false);

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
        const res = await fetch('/events/public');
        if (!res.ok) throw new Error('Failed to fetch events');
        const data: readonly PublicEvent[] = await res.json();
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

  // Clear lazy-loaded state when event changes
  useEffect(() => {
    setDocLoaded(false);
    setDocCategories([]);
    setDocScores([]);
    setOverallLoaded(false);
    setOverallRows([]);
    setAwardsLoaded(false);
    setManualAwards([]);
    setAutomaticAwards(null);
    setBracketRankings(null);
    setBracketRankingsLoadedForId(null);
  }, [selectedEventId]);

  // Load seeding data when event changes
  const loadSeeding = useCallback(async () => {
    if (!selectedEventId) {
      setTeams([]);
      setScores([]);
      setRankings([]);
      return;
    }
    setSeedingLoading(true);
    try {
      const [teamsRes, scoresRes, rankingsRes] = await Promise.all([
        fetch(`/teams/event/${selectedEventId}`),
        fetch(`/seeding/scores/event/${selectedEventId}`),
        fetch(`/seeding/rankings/event/${selectedEventId}`),
      ]);
      if (!teamsRes.ok || !scoresRes.ok || !rankingsRes.ok) {
        throw new Error('Failed to fetch seeding data');
      }
      setTeams(await teamsRes.json());
      setScores(await scoresRes.json());
      setRankings(await rankingsRes.json());
    } catch (error) {
      console.error('Error loading seeding data:', error);
    } finally {
      setSeedingLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadSeeding();
  }, [loadSeeding]);

  // Load brackets list when event changes
  useEffect(() => {
    if (!selectedEventId) {
      setBrackets([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/brackets/event/${selectedEventId}`);
        if (!res.ok) throw new Error('Failed to fetch brackets');
        const data: Bracket[] = await res.json();
        setBrackets(data);
      } catch (error) {
        console.error('Error loading brackets:', error);
      }
    })();
  }, [selectedEventId]);

  // Load bracket games when selected bracket changes
  const loadBracketGames = useCallback(async () => {
    if (!selectedBracketId) {
      setBracketGames([]);
      return;
    }
    setBracketLoading(true);
    try {
      const res = await fetch(`/brackets/${selectedBracketId}`);
      if (!res.ok) throw new Error('Failed to fetch bracket');
      const data = await res.json();
      setBracketGames(data.games ?? []);
    } catch (error) {
      console.error('Error loading bracket games:', error);
    } finally {
      setBracketLoading(false);
    }
  }, [selectedBracketId]);

  useEffect(() => {
    loadBracketGames();
  }, [loadBracketGames]);

  // Lazy-load documentation scores when tab is opened
  useEffect(() => {
    if (
      activeTab !== 'documentation' ||
      !selectedEventId ||
      !finalScoresAvailable ||
      docLoaded
    )
      return;
    setDocLoading(true);
    fetch(`/documentation-scores/event/${selectedEventId}/public`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        const data = (await res.json()) as PublicDocumentationScores;
        setDocCategories(data.categories);
        setDocScores(data.scores);
        setDocLoaded(true);
      })
      .catch((err) => console.error('Error loading documentation scores:', err))
      .finally(() => setDocLoading(false));
  }, [activeTab, selectedEventId, finalScoresAvailable, docLoaded]);

  // Lazy-load awards when tab is opened
  useEffect(() => {
    if (
      activeTab !== 'awards' ||
      !selectedEventId ||
      !finalScoresAvailable ||
      awardsLoaded
    )
      return;
    setAwardsLoading(true);
    fetch(`/awards/event/${selectedEventId}/public`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        const data = (await res.json()) as PublicEventAwardsResponse;
        setManualAwards(data.manual ?? []);
        setAutomaticAwards(data.automatic ?? null);
        setAwardsLoaded(true);
      })
      .catch((err) => console.error('Error loading awards:', err))
      .finally(() => setAwardsLoading(false));
  }, [activeTab, selectedEventId, finalScoresAvailable, awardsLoaded]);

  // Lazy-load bracket rankings when tab is opened
  useEffect(() => {
    if (
      activeTab !== 'bracketRankings' ||
      !selectedBracketId ||
      !finalScoresAvailable ||
      bracketRankingsLoadedForId === selectedBracketId
    )
      return;
    setBracketRankingsLoading(true);
    fetch(`/brackets/${selectedBracketId}/rankings/public`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setBracketRankings(data.entries);
        setBracketRankingsWeight(data.weight);
        setBracketRankingsLoadedForId(selectedBracketId);
      })
      .catch((err) => console.error('Error loading bracket rankings:', err))
      .finally(() => setBracketRankingsLoading(false));
  }, [
    activeTab,
    selectedBracketId,
    finalScoresAvailable,
    bracketRankingsLoadedForId,
  ]);

  // Lazy-load overall scores when tab is opened
  useEffect(() => {
    if (
      activeTab !== 'overall' ||
      !selectedEventId ||
      !finalScoresAvailable ||
      overallLoaded
    )
      return;
    setOverallLoading(true);
    fetch(`/events/${selectedEventId}/overall/public`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setOverallRows(data);
        setOverallLoaded(true);
      })
      .catch((err) => console.error('Error loading overall scores:', err))
      .finally(() => setOverallLoading(false));
  }, [activeTab, selectedEventId, finalScoresAvailable, overallLoaded]);

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
                              {award.recipients.length > 0 ? (
                                <ul className="spectator-manual-award-recipients">
                                  {award.recipients.map((r, ri) => (
                                    <li
                                      key={ri}
                                      className="spectator-manual-award-recipient"
                                    >
                                      <strong>#{r.team_number}</strong>{' '}
                                      <span className="spectator-manual-award-recipient-name">
                                        {r.team_name}
                                      </span>
                                    </li>
                                  ))}
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
