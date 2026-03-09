import React, { useEffect, useState, useMemo, useCallback } from 'react';
import Navbar from '../components/Navbar';
import SeedingDisplay from '../components/seeding/SeedingDisplay';
import BracketLikeView from '../components/bracket/BracketLikeView';
import { getBracketWinner } from '../components/bracket/bracketUtils';
import type {
  Team,
  SeedingScore,
  SeedingRanking,
} from '../components/seeding/SeedingScoresTable';
import type { Bracket, BracketGame } from '../types/brackets';
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
}

type SpectatorTab = 'seeding' | 'bracket';

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

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

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

  const handleEventChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(e.target.value);
    setSelectedEventId(id || null);
    setActiveTab('seeding');
  };

  const winner = useMemo(
    () => (bracketGames.length > 0 ? getBracketWinner(bracketGames) : null),
    [bracketGames],
  );

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
                    {brackets.length > 1 && (
                      <div className="spectator-bracket-selector">
                        <label htmlFor="spectator-bracket">Bracket</label>
                        <select
                          id="spectator-bracket"
                          value={selectedBracketId ?? ''}
                          onChange={(e) =>
                            setSelectedBracketId(Number(e.target.value) || null)
                          }
                        >
                          {brackets.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

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
          </>
        )}
      </main>
    </div>
  );
}
