import React, { useEffect, useState, useMemo, useCallback } from 'react';
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

type SpectatorTab =
  | 'seeding'
  | 'bracket'
  | 'documentation'
  | 'bracketRankings'
  | 'overall';

export default function Spectator() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<SpectatorTab>('seeding');

  // Seeding state
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<SeedingScore[]>([]);
  const [rankings, setRankings] = useState<SeedingRanking[]>([]);
  const [seedingLoading, setSeedingLoading] = useState(false);

  // Bracket state
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [selectedBracketId, setSelectedBracketId] = useState<number | null>(
    null,
  );
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

  // Overall state (lazy-loaded)
  const [overallRows, setOverallRows] = useState<OverallRow[]>([]);
  const [overallLoading, setOverallLoading] = useState(false);
  const [overallLoaded, setOverallLoaded] = useState(false);

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

  // Load public events
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/events/public');
        if (!res.ok) throw new Error('Failed to fetch events');
        const data: PublicEvent[] = await res.json();
        setEvents(data);
        if (data.length > 0) {
          setSelectedEventId(data[0].id);
        }
      } catch (error) {
        console.error('Error loading events:', error);
      } finally {
        setEventsLoading(false);
      }
    })();
  }, []);

  // Clear lazy-loaded state when event changes
  useEffect(() => {
    setDocLoaded(false);
    setDocCategories([]);
    setDocScores([]);
    setOverallLoaded(false);
    setOverallRows([]);
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
  const loadBrackets = useCallback(async () => {
    if (!selectedEventId) {
      setBrackets([]);
      setSelectedBracketId(null);
      return;
    }
    try {
      const res = await fetch(`/brackets/event/${selectedEventId}`);
      if (!res.ok) throw new Error('Failed to fetch brackets');
      const data: Bracket[] = await res.json();
      setBrackets(data);
      setSelectedBracketId(data.length > 0 ? data[0].id : null);
    } catch (error) {
      console.error('Error loading brackets:', error);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadBrackets();
  }, [loadBrackets]);

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
    setSelectedEventId(id || null);
    setActiveTab('seeding');
  };

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
          onChange={(e) => setSelectedBracketId(Number(e.target.value) || null)}
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
            {/* Event selector */}
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

            {/* Tabs */}
            <div className="spectator-tabs">
              <button
                className={`spectator-tab-btn ${activeTab === 'seeding' ? 'active' : ''}`}
                onClick={() => setActiveTab('seeding')}
              >
                Seeding
              </button>
              <button
                className={`spectator-tab-btn ${activeTab === 'bracket' ? 'active' : ''}`}
                onClick={() => setActiveTab('bracket')}
              >
                Bracket
              </button>
              {finalScoresAvailable && (
                <>
                  <button
                    className={`spectator-tab-btn ${activeTab === 'documentation' ? 'active' : ''}`}
                    onClick={() => setActiveTab('documentation')}
                  >
                    Documentation
                  </button>
                  <button
                    className={`spectator-tab-btn ${activeTab === 'bracketRankings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('bracketRankings')}
                  >
                    Bracket Rankings
                  </button>
                  <button
                    className={`spectator-tab-btn ${activeTab === 'overall' ? 'active' : ''}`}
                    onClick={() => setActiveTab('overall')}
                  >
                    Overall
                  </button>
                </>
              )}
            </div>

            {/* Tab content */}
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
