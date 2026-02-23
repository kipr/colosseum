import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import SeedingScoresTable, {
  buildTeamRowData,
  Team,
  SeedingScore,
  SeedingRanking,
} from '../components/seeding/SeedingScoresTable';
import SeedingRankingsTable from '../components/seeding/SeedingRankingsTable';
import BracketListTable from '../components/bracket/BracketListTable';
import BracketDetailView from '../components/bracket/BracketDetailView';
import { Bracket, BracketDetail } from '../types/brackets';
import './EventView.css';

type Tab = 'seeding' | 'brackets';

interface PublicEvent {
  id: number;
  name: string;
  status: string;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
}

export default function EventView() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('seeding');

  // Seeding state
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<SeedingScore[]>([]);
  const [rankings, setRankings] = useState<SeedingRanking[]>([]);
  const [seedingLoading, setSeedingLoading] = useState(false);

  // Brackets state
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [bracketsLoading, setBracketsLoading] = useState(false);
  const [selectedBracketId, setSelectedBracketId] = useState<number | null>(
    null,
  );
  const [bracketDetail, setBracketDetail] = useState<BracketDetail | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    const fetchEvent = async () => {
      try {
        const response = await fetch(`/events/${eventId}/public`);
        if (!response.ok) {
          if (response.status === 404) {
            setEventError('Event not found');
          } else {
            throw new Error('Failed to fetch event');
          }
          return;
        }
        const data: PublicEvent = await response.json();
        setEvent(data);
      } catch (err) {
        setEventError(
          err instanceof Error ? err.message : 'Failed to load event',
        );
      } finally {
        setEventLoading(false);
      }
    };
    fetchEvent();
  }, [eventId]);

  const loadSeedingData = useCallback(async () => {
    if (!eventId) return;
    setSeedingLoading(true);
    try {
      const [teamsRes, scoresRes, rankingsRes] = await Promise.all([
        fetch(`/teams/event/${eventId}`),
        fetch(`/seeding/scores/event/${eventId}`),
        fetch(`/seeding/rankings/event/${eventId}`),
      ]);

      if (!teamsRes.ok) throw new Error('Failed to fetch teams');
      if (!scoresRes.ok) throw new Error('Failed to fetch scores');
      if (!rankingsRes.ok) throw new Error('Failed to fetch rankings');

      const [teamsData, scoresData, rankingsData] = await Promise.all([
        teamsRes.json(),
        scoresRes.json(),
        rankingsRes.json(),
      ]);

      setTeams(teamsData);
      setScores(scoresData);
      setRankings(rankingsData);
    } catch (err) {
      console.error('Error loading seeding data:', err);
    } finally {
      setSeedingLoading(false);
    }
  }, [eventId]);

  const loadBrackets = useCallback(async () => {
    if (!eventId) return;
    setBracketsLoading(true);
    try {
      const response = await fetch(`/brackets/event/${eventId}`);
      if (!response.ok) throw new Error('Failed to fetch brackets');
      const data: Bracket[] = await response.json();
      setBrackets(data);
    } catch (err) {
      console.error('Error loading brackets:', err);
    } finally {
      setBracketsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (event && activeTab === 'seeding') {
      loadSeedingData();
    }
  }, [event, activeTab, loadSeedingData]);

  useEffect(() => {
    if (event && activeTab === 'brackets') {
      loadBrackets();
    }
  }, [event, activeTab, loadBrackets]);

  useEffect(() => {
    if (selectedBracketId) {
      setDetailLoading(true);
      fetch(`/brackets/${selectedBracketId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error('Failed to fetch bracket');
          const data: BracketDetail = await res.json();
          setBracketDetail(data);
        })
        .catch((err) => console.error('Error loading bracket detail:', err))
        .finally(() => setDetailLoading(false));
    } else {
      setBracketDetail(null);
    }
  }, [selectedBracketId]);

  const effectiveRounds = event
    ? event.seeding_rounds > 0
      ? event.seeding_rounds
      : 3
    : 3;

  const teamRowData = buildTeamRowData(
    teams,
    scores,
    rankings,
    effectiveRounds,
  );

  if (eventLoading) {
    return (
      <div className="event-view-page">
        <Navbar />
        <div className="event-view-content">
          <p>Loading event...</p>
        </div>
      </div>
    );
  }

  if (eventError || !event) {
    return (
      <div className="event-view-page">
        <Navbar />
        <div className="event-view-content">
          <div className="card">
            <p style={{ color: 'var(--danger-color)' }}>
              {eventError || 'Event not found'}
            </p>
            <Link
              to="/event"
              className="btn btn-secondary"
              style={{ marginTop: '1rem' }}
            >
              ← Back to Events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="event-view-page">
      <Navbar />
      <div className="event-view-content">
        <div className="event-view-header">
          <Link to="/event" className="event-view-back">
            ← All Events
          </Link>
          <h1>{event.name}</h1>
        </div>

        <div className="event-view-tabs">
          <button
            className={`event-view-tab ${activeTab === 'seeding' ? 'active' : ''}`}
            onClick={() => setActiveTab('seeding')}
          >
            Seeding
          </button>
          <button
            className={`event-view-tab ${activeTab === 'brackets' ? 'active' : ''}`}
            onClick={() => setActiveTab('brackets')}
          >
            Brackets
          </button>
        </div>

        {activeTab === 'seeding' && (
          <div className="event-view-tab-content">
            {seedingLoading ? (
              <p>Loading seeding data...</p>
            ) : teams.length === 0 ? (
              <div className="card">
                <p style={{ color: 'var(--secondary-color)' }}>
                  No seeding data available for this event.
                </p>
              </div>
            ) : (
              <>
                <SeedingScoresTable
                  teamRowData={teamRowData}
                  effectiveRounds={effectiveRounds}
                />
                <SeedingRankingsTable rankings={rankings} />
                <div className="seeding-summary">
                  {teams.length} team{teams.length !== 1 ? 's' : ''} •{' '}
                  {rankings.filter((r) => r.seed_rank !== null).length} ranked
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'brackets' && (
          <div className="event-view-tab-content">
            {bracketsLoading ? (
              <p>Loading brackets...</p>
            ) : !selectedBracketId ? (
              <div className="card">
                <BracketListTable
                  brackets={brackets}
                  onSelect={setSelectedBracketId}
                />
              </div>
            ) : detailLoading ? (
              <p>Loading bracket details...</p>
            ) : bracketDetail ? (
              <BracketDetailView
                bracketDetail={bracketDetail}
                onBack={() => {
                  setSelectedBracketId(null);
                  setBracketDetail(null);
                }}
              />
            ) : (
              <p>Bracket not found.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
