import React, { useState } from 'react';
import { BracketDetail, BracketEntryWithRank } from '../../types/brackets';
import { STATUS_LABELS } from '../../types/brackets';
import { getStatusClass } from './bracketUtils';
import BracketView from './BracketView';
import BracketManagementView from './BracketManagementView';
import BracketRankingView from './BracketRankingView';
import './BracketDisplay.css';

type DetailViewMode = 'bracket' | 'ranking' | 'management';

interface BracketDetailViewProps {
  bracketDetail: BracketDetail;
  onBack: () => void;
  adminActions?: React.ReactNode;
  entriesActions?: React.ReactNode;
  gamesActions?: React.ReactNode;
  rankings: BracketEntryWithRank[] | null;
  rankingsWeight: number;
  rankingsLoading: boolean;
  onRefreshRankings?: () => void;
  allowedModes?: DetailViewMode[];
}

export default function BracketDetailView({
  bracketDetail,
  onBack,
  adminActions,
  entriesActions,
  gamesActions,
  rankings,
  rankingsWeight,
  rankingsLoading,
  onRefreshRankings,
  allowedModes,
}: BracketDetailViewProps) {
  const modes: DetailViewMode[] = allowedModes ?? [
    'bracket',
    'ranking',
    'management',
  ];
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>(
    modes[0],
  );

  const modeLabels: Record<DetailViewMode, string> = {
    bracket: 'Bracket View',
    ranking: 'Ranking View',
    management: 'Management View',
  };

  return (
    <>
      <div className="brackets-controls">
        <button className="btn btn-secondary" onClick={onBack}>
          &larr; Back to List
        </button>
        {bracketDetail.games.length > 0 && modes.length > 1 && (
          <div className="view-mode-toggle">
            {modes.map((mode) => (
              <button
                key={mode}
                className={`btn ${detailViewMode === mode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDetailViewMode(mode)}
              >
                {modeLabels[mode]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bracket Header */}
      <div className="card bracket-header-card">
        <div className="bracket-header">
          <div className="bracket-header-info">
            <h3>{bracketDetail.name}</h3>
            <div className="bracket-meta">
              <span>
                <strong>Size:</strong> {bracketDetail.bracket_size}
              </span>
              <span>
                <strong>Teams:</strong>{' '}
                {bracketDetail.actual_team_count || 'Not set'}
              </span>
              <span
                className={`bracket-status-badge ${getStatusClass(bracketDetail.status)}`}
              >
                {STATUS_LABELS[bracketDetail.status]}
              </span>
            </div>
          </div>
          {adminActions && (
            <div className="bracket-header-actions">{adminActions}</div>
          )}
        </div>
      </div>

      {/* Bracket View */}
      {detailViewMode === 'bracket' && (
        <BracketView bracketDetail={bracketDetail} />
      )}

      {/* Ranking View */}
      {detailViewMode === 'ranking' && (
        <BracketRankingView
          bracketId={bracketDetail.id}
          rankings={rankings}
          weight={rankingsWeight}
          loading={rankingsLoading}
          onRefresh={onRefreshRankings}
        />
      )}

      {/* Management View */}
      {detailViewMode === 'management' && (
        <BracketManagementView
          bracketDetail={bracketDetail}
          entriesActions={entriesActions}
          gamesActions={gamesActions}
        />
      )}
    </>
  );
}
