import React, { useEffect, useRef } from 'react';
import { BracketEntryWithRank } from '../../types/brackets';
import './BracketDisplay.css';

interface BracketRankingViewProps {
  bracketId: number;
  rankings: BracketEntryWithRank[] | null;
  loading: boolean;
  onRefresh: () => void;
}

function getRankLabel(rank: number): string {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

function getRankRowClass(rank: number | null): string {
  if (rank === 1) return 'ranking-row-gold';
  if (rank === 2) return 'ranking-row-silver';
  if (rank === 3) return 'ranking-row-bronze';
  return '';
}

export default function BracketRankingView({
  rankings,
  loading,
  onRefresh,
}: BracketRankingViewProps) {
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (!refreshedRef.current) {
      refreshedRef.current = true;
      onRefresh();
    }
  }, [onRefresh]);

  if (loading) {
    return (
      <div className="card bracket-section">
        <p>Loading rankings...</p>
      </div>
    );
  }

  if (!rankings || rankings.length === 0) {
    return (
      <div className="card bracket-section">
        <div className="bracket-section-header">
          <h4>Rankings</h4>
        </div>
        <p style={{ color: 'var(--secondary-color)' }}>
          No rankings available. Rankings are calculated as bracket games are
          completed.
        </p>
      </div>
    );
  }

  const realEntries = rankings.filter((e) => !e.is_bye);
  const ranked = realEntries.filter((e) => e.final_rank !== null);
  const unranked = realEntries.filter((e) => e.final_rank === null);

  return (
    <div className="card bracket-section">
      <div className="bracket-section-header">
        <h4>Rankings ({ranked.length} placed)</h4>
      </div>

      <table className="ranking-table">
        <thead>
          <tr>
            <th>Place</th>
            <th>Team #</th>
            <th>Team Name</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((entry) => (
            <tr key={entry.id} className={getRankRowClass(entry.final_rank!)}>
              <td className="ranking-place">
                <strong>{getRankLabel(entry.final_rank!)}</strong>
              </td>
              <td>{entry.team_number ?? '—'}</td>
              <td>{entry.team_name ?? entry.display_name ?? '—'}</td>
            </tr>
          ))}
          {unranked.length > 0 && (
            <>
              {ranked.length > 0 && (
                <tr className="ranking-divider-row">
                  <td colSpan={3}>
                    <span className="ranking-divider-label">
                      Not yet placed
                    </span>
                  </td>
                </tr>
              )}
              {unranked.map((entry) => (
                <tr key={entry.id} className="ranking-row-unranked">
                  <td className="ranking-place">
                    <span style={{ color: 'var(--secondary-color)' }}>—</span>
                  </td>
                  <td>{entry.team_number ?? '—'}</td>
                  <td>{entry.team_name ?? entry.display_name ?? '—'}</td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
