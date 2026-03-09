import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEvent } from '../../contexts/EventContext';
import { useToast } from '../Toast';
import { Bracket } from '../../types/brackets';
import './DocumentationTab.css';

interface Team {
  id: number;
  event_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

interface DocScore {
  team_id: number;
  overall_score: number | null;
}

interface SeedingRanking {
  team_id: number;
  raw_seed_score: number | null;
}

interface BracketRankingEntry {
  team_id: number | null;
  weighted_bracket_raw_score: number | null;
}

interface OverallRow {
  team_id: number;
  team_number: number;
  team_name: string;
  doc_score: number;
  raw_seed_score: number;
  weighted_de_score: number;
  total: number;
}

function formatScore(val: number): string {
  return val.toFixed(4);
}

export default function OverallTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const [teams, setTeams] = useState<Team[]>([]);
  const [docScores, setDocScores] = useState<DocScore[]>([]);
  const [seedingRankings, setSeedingRankings] = useState<SeedingRanking[]>([]);
  const [weightedDeByTeam, setWeightedDeByTeam] = useState<Map<number, number>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadAll = useCallback(async () => {
    if (!selectedEventId) {
      setTeams([]);
      setDocScores([]);
      setSeedingRankings([]);
      setWeightedDeByTeam(new Map());
      return;
    }

    setLoading(true);
    try {
      const [teamsRes, docRes, seedRes, bracketsRes] = await Promise.all([
        fetch(`/teams/event/${selectedEventId}`, { credentials: 'include' }),
        fetch(`/documentation-scores/event/${selectedEventId}`, {
          credentials: 'include',
        }),
        fetch(`/seeding/rankings/event/${selectedEventId}`, {
          credentials: 'include',
        }),
        fetch(`/brackets/event/${selectedEventId}`, { credentials: 'include' }),
      ]);

      if (!teamsRes.ok) throw new Error('Failed to fetch teams');
      if (!docRes.ok) throw new Error('Failed to fetch documentation scores');
      if (!seedRes.ok) throw new Error('Failed to fetch seeding rankings');
      if (!bracketsRes.ok) throw new Error('Failed to fetch brackets');

      const [teamsData, docData, seedData, bracketsData] = await Promise.all([
        teamsRes.json(),
        docRes.json(),
        seedRes.json(),
        bracketsRes.json(),
      ]);

      setTeams(teamsData);
      setDocScores(docData);
      setSeedingRankings(seedData);

      const brackets: Bracket[] = bracketsData;
      const deMap = new Map<number, number>();

      for (const bracket of brackets) {
        const rankingsRes = await fetch(`/brackets/${bracket.id}/rankings`, {
          credentials: 'include',
        });
        if (!rankingsRes.ok) continue;

        const { entries } = (await rankingsRes.json()) as {
          weight: number;
          entries: BracketRankingEntry[];
        };

        for (const entry of entries) {
          if (
            entry.team_id != null &&
            entry.weighted_bracket_raw_score != null
          ) {
            deMap.set(entry.team_id, entry.weighted_bracket_raw_score);
          }
        }
      }

      setWeightedDeByTeam(deMap);
    } catch (err) {
      console.error(err);
      toastRef.current.error(
        err instanceof Error ? err.message : 'Failed to load overall scores',
      );
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const docByTeam = new Map(
    docScores.map((s) => [s.team_id, s.overall_score ?? 0]),
  );
  const seedByTeam = new Map(
    seedingRankings.map((s) => [s.team_id, s.raw_seed_score ?? 0]),
  );

  const rows: OverallRow[] = teams.map((team) => {
    const doc = docByTeam.get(team.id) ?? 0;
    const seed = seedByTeam.get(team.id) ?? 0;
    const de = weightedDeByTeam.get(team.id) ?? 0;
    const total = doc + seed + de;
    return {
      team_id: team.id,
      team_number: team.team_number,
      team_name: team.team_name,
      doc_score: doc,
      raw_seed_score: seed,
      weighted_de_score: de,
      total,
    };
  });

  const sortedRows = [...rows].sort((a, b) => b.total - a.total);

  if (!selectedEventId) {
    return (
      <div className="documentation-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to view overall scores.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="documentation-tab">
      {loading && <p style={{ color: 'var(--secondary-color)' }}>Loading...</p>}

      <div className="card documentation-section">
        <h3>Overall Scores</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
          Combined score per team: Documentation + Raw Seeding (0–1) + Weighted
          DE. Sorted by total descending.
        </p>
        <div className="doc-scores-table-wrapper">
          <table className="doc-calculator-table">
            <thead>
              <tr>
                <th>Team #</th>
                <th>Team Name</th>
                <th>Doc Score</th>
                <th className="doc-op">+</th>
                <th>Raw Seeding</th>
                <th className="doc-op">+</th>
                <th>Weighted DE</th>
                <th className="doc-op">=</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.team_id}>
                  <td>{row.team_number}</td>
                  <td>{row.team_name}</td>
                  <td>{formatScore(row.doc_score)}</td>
                  <td className="doc-op">+</td>
                  <td>{formatScore(row.raw_seed_score)}</td>
                  <td className="doc-op">+</td>
                  <td>{formatScore(row.weighted_de_score)}</td>
                  <td className="doc-op">=</td>
                  <td>
                    <strong style={{ color: 'var(--primary-color)' }}>
                      {formatScore(row.total)}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
