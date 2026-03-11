import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import SeedingDisplay from '../components/seeding/SeedingDisplay';
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
import type {
  Bracket,
  BracketGame,
  BracketEntryWithRank,
  BracketSide,
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
} from '../utils/routes';
import '../components/bracket/BracketDisplay.css';
import './Spectator.css';

interface PublicEvent {
  id: number;
  name: string;
  status: string;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
  final_scores_available: boolean;
}

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

  const [events, setEvents] = useState<PublicEvent[]>([]);
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
  const [docCategories, setDocCategories] = useState<DocCategoryDisplay[]>([]);
  const [docScores, setDocScores] = useState<DocScoreDisplay[]>([]);
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
  interface PublicAward {
    name: string;
    description: string | null;
    sort_order: number;
    recipients: {
      team_number: number;
      team_name: string;
    }[];
  }
  const [publicAwards, setPublicAwards] = useState<PublicAward[]>([]);
  const [awardsLoading, setAwardsLoading] = useState(false);
  const [awardsLoaded, setAwardsLoaded] = useState(false);

  // Overall state (lazy-loaded)
  const [overallRows, setOverallRows] = useState<OverallRow[]>([]);
  const [overallLoading, setOverallLoading] = useState(false);
  const [overallLoaded, setOverallLoaded] = useState(false);

  const selectedEventId = eventIdParam ? Number(eventIdParam) : null;
  const selectedBracketId = bracketIdParam ? Number(bracketIdParam) : null;

  const viewParam = searchParams.get('view');
  const sideParam = searchParams.get('side');

  const bracketSide: BracketSide | undefined = isBracketSide(sideParam)
    ? sideParam
    : undefined;

  const handleSideChange = useCallback(
    (side: BracketSide) => {
      const next: Record<string, string> = { side };
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

  // Load public events and redirect to first event if no eventId in URL
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/events/public');
        if (!res.ok) throw new Error('Failed to fetch events');
        const data: PublicEvent[] = await res.json();
        setEvents(data);
        if (!eventIdParam && data.length > 0) {
          navigate(spectatorEventPath(data[0].id, 'seeding'), {
            replace: true,
          });
        }
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
      navigate(spectatorEventPath(events[0].id, 'seeding'), { replace: true });
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
    setPublicAwards([]);
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
        const data = await res.json();
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
        setPublicAwards(await res.json());
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

  const handleEventChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(e.target.value);
    if (id) {
      navigate(spectatorEventPath(id, 'seeding'));
    }
  };

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
      <main className="spectator-container">
        <div className="spectator-header">
          <h2>Spectator</h2>
          <p>View live seeding scores and bracket results.</p>
        </div>

        {eventsLoading ? (
          <p>Loading events...</p>
        ) : events.length === 0 ? (
          <div className="card">
            <p style={{ color: 'var(--secondary-color)' }}>
              No events are currently available.
            </p>
          </div>
        ) : (
          <>
            <div className="spectator-event-selector">
              <label htmlFor="spectator-event">Event</label>
              <select
                id="spectator-event"
                value={selectedEventId ?? ''}
                onChange={handleEventChange}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
              {selectedEvent && (
                <div className="spectator-event-meta">
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
              <div>
                {seedingLoading ? (
                  <p>Loading seeding data...</p>
                ) : (
                  <SeedingDisplay
                    teams={teams}
                    scores={scores}
                    rankings={rankings}
                    effectiveRounds={effectiveRounds}
                  />
                )}
              </div>
            )}

            {activeTab === 'bracket' && (
              <div>
                {brackets.length === 0 ? (
                  <div className="card">
                    <p style={{ color: 'var(--secondary-color)' }}>
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
                            <span className="bracket-winner-trophy" aria-hidden>
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
                  <DocumentationScoresDisplay
                    categories={docCategories}
                    scores={docScores}
                  />
                )}
              </div>
            )}

            {activeTab === 'awards' && finalScoresAvailable && (
              <div>
                {awardsLoading ? (
                  <p>Loading awards...</p>
                ) : publicAwards.length === 0 ? (
                  <div className="card">
                    <p style={{ color: 'var(--secondary-color)' }}>
                      No awards have been published for this event.
                    </p>
                  </div>
                ) : (
                  <div className="card">
                    <h3 style={{ marginBottom: '1rem' }}>Awards</h3>
                    {publicAwards.map((award, idx) => (
                      <div
                        key={idx}
                        style={{
                          marginBottom:
                            idx < publicAwards.length - 1 ? '1.25rem' : 0,
                          paddingBottom:
                            idx < publicAwards.length - 1 ? '1.25rem' : 0,
                          borderBottom:
                            idx < publicAwards.length - 1
                              ? '1px solid var(--border-color)'
                              : 'none',
                        }}
                      >
                        <strong style={{ fontSize: '1.05rem' }}>
                          {award.name}
                        </strong>
                        {award.description && (
                          <p
                            style={{
                              color: 'var(--secondary-color)',
                              margin: '0.25rem 0 0.5rem',
                            }}
                          >
                            {award.description}
                          </p>
                        )}
                        {award.recipients.length > 0 ? (
                          <ul
                            style={{
                              margin: '0.5rem 0 0',
                              paddingLeft: '1.25rem',
                            }}
                          >
                            {award.recipients.map((r, ri) => (
                              <li key={ri}>
                                <strong>#{r.team_number}</strong> {r.team_name}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p
                            style={{
                              color: 'var(--secondary-color)',
                              margin: '0.5rem 0 0',
                              fontStyle: 'italic',
                            }}
                          >
                            No recipients
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'bracketRankings' && finalScoresAvailable && (
              <div>
                {brackets.length === 0 ? (
                  <div className="card">
                    <p style={{ color: 'var(--secondary-color)' }}>
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
                    />
                  </>
                )}
              </div>
            )}

            {activeTab === 'overall' && finalScoresAvailable && (
              <div>
                {overallLoading ? (
                  <p>Loading overall scores...</p>
                ) : (
                  <OverallScoresDisplay rows={overallRows} />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
