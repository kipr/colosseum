import { FormEvent, useMemo } from 'react';
import { nextPowerOfTwo } from '../../../types/brackets';
import { UnifiedTable } from '../../table';
import type { UnifiedColumnDef } from '../../table';
import type { AssignedTeam } from '../../../types/brackets';
import type {
  CreateModalDoubleSeedingRanking,
  CreateModalRanking,
  CreateModalTeam,
} from '../../../hooks/brackets';
import {
  buildCreateMatrixRows,
  type BracketCreateMatrixRow,
} from './buildCreateMatrix';
import '../../Modal.css';

export interface BracketFormData {
  name: string;
  bracket_size: number;
  actual_team_count: string;
  weight: string;
}

interface BracketCreateModalProps {
  formData: BracketFormData;
  setFormData: (data: BracketFormData) => void;
  saving: boolean;
  createDataLoading: boolean;
  createTeams: CreateModalTeam[];
  createRankings: CreateModalRanking[];
  createDoubleSeedingRankings: CreateModalDoubleSeedingRanking[];
  createAssigned: AssignedTeam[];
  selectedTeamIds: Set<number>;
  setSelectedTeamIds: (
    next: Set<number> | ((prev: Set<number>) => Set<number>),
  ) => void;
  doubleSeedingEnabled: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}

export default function BracketCreateModal({
  formData,
  setFormData,
  saving,
  createDataLoading,
  createTeams,
  createRankings,
  createDoubleSeedingRankings,
  createAssigned,
  selectedTeamIds,
  setSelectedTeamIds,
  doubleSeedingEnabled,
  onClose,
  onSubmit,
}: BracketCreateModalProps) {
  const bracketCreateMatrixRows = useMemo(
    () =>
      buildCreateMatrixRows({
        teams: createTeams,
        rankings: createRankings,
        doubleSeedingRankings: createDoubleSeedingRankings,
        assigned: createAssigned,
        selectedTeamIds,
        doubleSeedingEnabled,
      }),
    [
      createTeams,
      createRankings,
      createDoubleSeedingRankings,
      createAssigned,
      selectedTeamIds,
      doubleSeedingEnabled,
    ],
  );

  const bracketCreateMatrixColumns =
    useMemo((): UnifiedColumnDef<BracketCreateMatrixRow>[] => {
      const cols: UnifiedColumnDef<BracketCreateMatrixRow>[] = [
        {
          kind: 'data',
          id: 'select',
          header: { full: 'Select' },
          headerStyle: { width: 40 },
          renderCell: (r) => (
            <input
              type="checkbox"
              checked={selectedTeamIds.has(r.team.id)}
              onChange={(e) => {
                setSelectedTeamIds((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) {
                    next.add(r.team.id);
                  } else {
                    next.delete(r.team.id);
                  }
                  return next;
                });
              }}
              disabled={!!r.assigned}
              title={
                r.assigned
                  ? `${r.team.team_name} is already in ${r.assigned.bracket_name}`
                  : undefined
              }
            />
          ),
        },
        {
          kind: 'data',
          id: 'team_number',
          header: { full: 'Team #' },
          renderCell: (r) => r.team.team_number,
        },
        {
          kind: 'data',
          id: 'team_name',
          header: { full: 'Team Name' },
          renderCell: (r) => r.team.team_name,
        },
      ];
      cols.push(
        {
          kind: 'data',
          id: 'seed_avg',
          header: { full: 'Seed Avg' },
          renderCell: (r) =>
            r.ranking?.seed_average != null
              ? r.ranking.seed_average.toFixed(2)
              : '—',
        },
        {
          kind: 'data',
          id: 'rank',
          header: { full: 'Rank' },
          renderCell: (r) => r.ranking?.seed_rank ?? '—',
        },
      );
      if (doubleSeedingEnabled) {
        cols.push(
          {
            kind: 'data',
            id: 'ds_avg',
            header: { full: 'DS Avg' },
            renderCell: (r) =>
              r.doubleSeedingRanking?.seed_average?.toFixed(2) ?? '—',
          },
          {
            kind: 'data',
            id: 'ds_rank',
            header: { full: 'DS Rank' },
            renderCell: (r) => r.doubleSeedingRanking?.seed_rank ?? '—',
          },
          {
            kind: 'data',
            id: 'combined_avg',
            header: { full: 'Combined Avg' },
            renderCell: (r) =>
              r.ranking?.seed_average != null &&
              r.doubleSeedingRanking?.seed_average != null
                ? (
                    (r.ranking.seed_average +
                      r.doubleSeedingRanking.seed_average) /
                    2
                  ).toFixed(2)
                : '—',
          },
        );
      }
      cols.push({
        kind: 'data',
        id: 'assigned',
        header: { full: 'Assigned' },
        renderCell: (r) =>
          r.assigned ? (
            <span
              className="bracket-create-assigned"
              title={`In ${r.assigned.bracket_name}`}
            >
              {r.assigned.bracket_name}
            </span>
          ) : (
            '—'
          ),
      });
      return cols;
    }, [doubleSeedingEnabled, selectedTeamIds, setSelectedTeamIds]);

  const hasOverlap = Array.from(selectedTeamIds).some((id) =>
    createAssigned.some((a) => a.team_id === id),
  );

  return (
    <div className="modal show" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '90vw', width: '800px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onClose}>
          &times;
        </span>
        <h3>Create Bracket</h3>
        <p
          style={{
            color: 'var(--secondary-color)',
            marginBottom: '1rem',
          }}
        >
          Select teams for this bracket. Bracket size and byes are computed
          automatically.
        </p>

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label htmlFor="bracket-name">Bracket Name *</label>
            <input
              id="bracket-name"
              type="text"
              className="field-input"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="e.g., Main Bracket, Division A"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="bracket-weight">Weight</label>
            <input
              id="bracket-weight"
              type="number"
              className="field-input"
              value={formData.weight}
              onChange={(e) =>
                setFormData({ ...formData, weight: e.target.value })
              }
              placeholder="1"
              min={0.01}
              max={1}
              step="any"
            />
          </div>

          {createDataLoading ? (
            <p>Loading teams...</p>
          ) : createTeams.length === 0 ? (
            <p style={{ color: 'var(--secondary-color)' }}>
              No teams in this event. Add teams first.
            </p>
          ) : (
            <>
              <div className="form-group">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <label style={{ marginBottom: 0 }}>Select Teams</label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      const availableTeamIds = createTeams
                        .filter(
                          (team) =>
                            !createAssigned.some(
                              (assigned) => assigned.team_id === team.id,
                            ),
                        )
                        .map((team) => team.id);
                      setSelectedTeamIds(new Set(availableTeamIds));
                    }}
                    disabled={createTeams.length === 0}
                  >
                    Select All Available
                  </button>
                </div>
                <div
                  className="table-responsive"
                  style={{ maxHeight: '300px', overflow: 'auto' }}
                >
                  <UnifiedTable
                    columns={bracketCreateMatrixColumns}
                    rows={bracketCreateMatrixRows}
                    getRowKey={(r) => r.team.id}
                    rowClassName={(r) =>
                      r.hasOverlap ? 'bracket-create-overlap' : ''
                    }
                    tableClassName="bracket-create-teams-table"
                    headerLabelVariant="none"
                  />
                </div>
              </div>

              {selectedTeamIds.size > 0 && (
                <div
                  className="bracket-create-summary"
                  style={{
                    marginBottom: '1rem',
                    padding: '0.5rem',
                    background: 'var(--surface-color)',
                    borderRadius: '4px',
                  }}
                >
                  <strong>Selected:</strong> {selectedTeamIds.size} teams
                  {' · '}
                  <strong>Bracket size:</strong>{' '}
                  {nextPowerOfTwo(selectedTeamIds.size)} <strong>Byes:</strong>{' '}
                  {nextPowerOfTwo(selectedTeamIds.size) - selectedTeamIds.size}
                </div>
              )}

              {hasOverlap && (
                <div
                  className="bracket-create-overlap-warning"
                  style={{
                    color: 'var(--danger-color)',
                    marginBottom: '1rem',
                    fontSize: '0.9rem',
                  }}
                >
                  Some selected teams are already in another bracket. Remove
                  them to continue.
                </div>
              )}
            </>
          )}

          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end',
              marginTop: '1.5rem',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                saving ||
                createDataLoading ||
                selectedTeamIds.size === 0 ||
                hasOverlap
              }
            >
              {saving ? 'Creating...' : 'Create Bracket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
