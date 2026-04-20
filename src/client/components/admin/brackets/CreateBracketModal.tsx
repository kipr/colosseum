import { useMemo, useState } from 'react';
import { Modal, ModalActions } from '../../Modal';
import { UnifiedTable, type UnifiedColumnDef } from '../../table';
import { useCreateBracketData } from './useCreateBracketData';
import {
  defaultFormData,
  nextPowerOfTwo,
  type AssignedTeam,
  type BracketCreateMatrixRow,
  type BracketFormData,
  type CreateModalRanking,
  type CreateModalScore,
  type CreateModalTeam,
} from './types';

export interface CreateBracketSubmit {
  name: string;
  weight?: number;
  team_ids: number[];
}

interface CreateBracketModalProps {
  open: boolean;
  eventId: number | null;
  seedingRounds: number;
  saving: boolean;
  onClose: () => void;
  onError: (message: string) => void;
  onSubmit: (data: CreateBracketSubmit) => Promise<void>;
}

function buildMatrixRows(
  teams: CreateModalTeam[],
  scores: CreateModalScore[],
  rankings: CreateModalRanking[],
  assigned: AssignedTeam[],
  selectedTeamIds: Set<number>,
): BracketCreateMatrixRow[] {
  return [...teams]
    .sort((a, b) => {
      const rankA = rankings.find((r) => r.team_id === a.id)?.seed_rank;
      const rankB = rankings.find((r) => r.team_id === b.id)?.seed_rank;
      if (rankA == null && rankB == null) return a.team_number - b.team_number;
      if (rankA == null) return 1;
      if (rankB == null) return -1;
      return rankA - rankB;
    })
    .map((team) => {
      const scoreMap = new Map<number, number | null>();
      for (const s of scores) {
        if (s.team_id === team.id) scoreMap.set(s.round_number, s.score);
      }
      const ranking = rankings.find((r) => r.team_id === team.id);
      const assignedRow = assigned.find((a) => a.team_id === team.id);
      const isSelected = selectedTeamIds.has(team.id);
      const hasOverlap = isSelected && !!assignedRow;
      return {
        team,
        scoreMap,
        ranking,
        assigned: assignedRow,
        hasOverlap,
      };
    });
}

function buildMatrixColumns(
  rounds: number,
  selectedTeamIds: Set<number>,
  setSelectedTeamIds: (next: Set<number>) => void,
): UnifiedColumnDef<BracketCreateMatrixRow>[] {
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
            const next = new Set(selectedTeamIds);
            if (e.target.checked) next.add(r.team.id);
            else next.delete(r.team.id);
            setSelectedTeamIds(next);
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
  for (let i = 0; i < rounds; i++) {
    cols.push({
      kind: 'data',
      id: `r${i + 1}`,
      header: { full: `R${i + 1}` },
      renderCell: (r) => r.scoreMap.get(i + 1) ?? '—',
    });
  }
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
    {
      kind: 'data',
      id: 'raw',
      header: { full: 'Raw' },
      renderCell: (r) =>
        r.ranking?.raw_seed_score != null
          ? r.ranking.raw_seed_score.toFixed(4)
          : '—',
    },
    {
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
    },
  );
  return cols;
}

/** Modal for creating a new bracket. Owns its own form state and team-pick UI. */
export function CreateBracketModal({
  open,
  eventId,
  seedingRounds,
  saving,
  onClose,
  onError,
  onSubmit,
}: CreateBracketModalProps) {
  const [formData, setFormData] = useState<BracketFormData>(defaultFormData);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(
    new Set(),
  );

  const { teams, scores, rankings, assigned, loading } = useCreateBracketData(
    open,
    eventId,
    onError,
  );

  const rows = useMemo(
    () => buildMatrixRows(teams, scores, rankings, assigned, selectedTeamIds),
    [teams, scores, rankings, assigned, selectedTeamIds],
  );

  const columns = useMemo(
    () =>
      buildMatrixColumns(seedingRounds, selectedTeamIds, setSelectedTeamIds),
    [seedingRounds, selectedTeamIds],
  );

  const hasOverlap = Array.from(selectedTeamIds).some((id) =>
    assigned.some((a) => a.team_id === id),
  );

  const handleClose = () => {
    setFormData(defaultFormData);
    setSelectedTeamIds(new Set());
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      onError('Bracket name is required');
      return;
    }
    const teamIds = Array.from(selectedTeamIds);
    if (teamIds.length === 0) {
      onError('Select at least one team for the bracket');
      return;
    }
    await onSubmit({
      name: formData.name.trim(),
      team_ids: teamIds,
      weight: formData.weight ? parseFloat(formData.weight) : undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create Bracket"
      maxWidth="90vw"
      width={800}
    >
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
        Select teams for this bracket. Bracket size and byes are computed
        automatically.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="bracket-name">Bracket Name *</label>
          <input
            id="bracket-name"
            type="text"
            className="field-input"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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

        {loading ? (
          <p>Loading teams...</p>
        ) : teams.length === 0 ? (
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
                    const availableTeamIds = teams
                      .filter(
                        (team) => !assigned.some((a) => a.team_id === team.id),
                      )
                      .map((team) => team.id);
                    setSelectedTeamIds(new Set(availableTeamIds));
                  }}
                  disabled={teams.length === 0}
                >
                  Select All Available
                </button>
              </div>
              <div
                className="table-responsive"
                style={{ maxHeight: '300px', overflow: 'auto' }}
              >
                <UnifiedTable
                  columns={columns}
                  rows={rows}
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
                Some selected teams are already in another bracket. Remove them
                to continue.
              </div>
            )}
          </>
        )}

        <ModalActions>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              saving || loading || selectedTeamIds.size === 0 || hasOverlap
            }
          >
            {saving ? 'Creating...' : 'Create Bracket'}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}
