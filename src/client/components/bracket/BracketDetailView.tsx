import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BracketDetail,
  BracketEntryWithRank,
  BracketSide,
  BRACKET_STATUS_LABELS,
} from '../../types/brackets';
import { getStatusClass } from './bracketUtils';
import BracketView from './BracketView';
import BracketManagementView from './BracketManagementView';
import BracketRankingView from './BracketRankingView';
import {
  isBracketDetailView,
  isBracketSide,
  paramToBracketSide,
  bracketSideToParam,
} from '../../utils/routes';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const modes: DetailViewMode[] = allowedModes ?? [
    'bracket',
    'ranking',
    'management',
  ];

  const viewParam = searchParams.get('view');
  const sideParam = searchParams.get('side');
  const detailViewMode: DetailViewMode =
    isBracketDetailView(viewParam) && modes.includes(viewParam)
      ? viewParam
      : modes[0];

  const bracketSide: BracketSide | undefined = isBracketSide(sideParam)
    ? paramToBracketSide(sideParam)
    : undefined;

  const setDetailViewMode = (mode: DetailViewMode) => {
    const next: Record<string, string> = { view: mode };
    if (sideParam) next.side = sideParam;
    setSearchParams(next, { replace: true });
  };

  const handleSideChange = useCallback(
    (side: BracketSide) => {
      const next: Record<string, string> = { side: bracketSideToParam(side) };
      const currentView = searchParams.get('view');
      if (currentView) next.view = currentView;
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
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
                {BRACKET_STATUS_LABELS[bracketDetail.status]}
              </span>
            </div>
          </div>
          {adminActions && (
            <div className="bracket-header-actions">{adminActions}</div>
          )}
        </div>
      </div>

      {detailViewMode === 'bracket' && (
        <BracketView
          bracketDetail={bracketDetail}
          side={bracketSide}
          onSideChange={handleSideChange}
        />
      )}

      {detailViewMode === 'ranking' && (
        <BracketRankingView
          bracketId={bracketDetail.id}
          rankings={rankings}
          weight={rankingsWeight}
          loading={rankingsLoading}
          onRefresh={onRefreshRankings}
        />
      )}

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
