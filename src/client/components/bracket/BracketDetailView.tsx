import React, { useState } from 'react';
import { BracketDetail } from '../../types/brackets';
import { STATUS_LABELS } from '../../types/brackets';
import { getStatusClass } from './bracketUtils';
import BracketView from './BracketView';
import BracketManagementView from './BracketManagementView';
import './BracketDisplay.css';

type DetailViewMode = 'management' | 'bracket';

interface BracketDetailViewProps {
  bracketDetail: BracketDetail;
  onBack: () => void;
  adminActions?: React.ReactNode;
  entriesActions?: React.ReactNode;
  gamesActions?: React.ReactNode;
}

export default function BracketDetailView({
  bracketDetail,
  onBack,
  adminActions,
  entriesActions,
  gamesActions,
}: BracketDetailViewProps) {
  const [detailViewMode, setDetailViewMode] =
    useState<DetailViewMode>('bracket');

  return (
    <>
      <div className="brackets-controls">
        <button className="btn btn-secondary" onClick={onBack}>
          ← Back to List
        </button>
        {bracketDetail.games.length > 0 && (
          <div className="view-mode-toggle">
            <button
              className={`btn ${detailViewMode === 'bracket' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDetailViewMode('bracket')}
            >
              Bracket View
            </button>
            <button
              className={`btn ${detailViewMode === 'management' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDetailViewMode('management')}
            >
              Management View
            </button>
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
