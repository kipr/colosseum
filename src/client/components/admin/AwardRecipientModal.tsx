import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UnifiedTable,
  compareLocaleString,
  compareNullableNumber,
} from '../table';
import type { SortDirection, UnifiedColumnDef } from '../table';
import {
  awardWeight,
  compareByAwardLoad,
  type TeamAwardCounts,
} from '@shared/awards';
import '../Modal.css';
import './AwardsTab.css';
interface AwardRecipientModalProps {
  eventId: number;
  awardId: number;
  awardName: string;
  existingRecipientTeamIds: number[];
  onClose: () => void;
  onAdded: () => void | Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

type SortField =
  | 'weighted'
  | 'team_number'
  | 'team_name'
  | 'certificates'
  | 'trophies';

interface RecipientRow extends TeamAwardCounts {
  alreadyRecipient: boolean;
}

export default function AwardRecipientModal({
  eventId,
  awardId,
  awardName,
  existingRecipientTeamIds,
  onClose,
  onAdded,
  onError,
  onSuccess,
}: AwardRecipientModalProps) {
  const [rows, setRows] = useState<TeamAwardCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [filter, setFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('weighted');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const existingSet = useMemo(
    () => new Set(existingRecipientTeamIds),
    [existingRecipientTeamIds],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedTeamIds(new Set());
    fetch(`/awards/event/${eventId}/team-award-counts`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load team award counts');
        return (await res.json()) as TeamAwardCounts[];
      })
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) {
          onError(
            err instanceof Error
              ? err.message
              : 'Failed to load team award counts',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, onError]);

  const handleSort = useCallback((sortId: string) => {
    const field = sortId as SortField;
    setSortField((prev) => {
      if (prev === field) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDirection(field === 'weighted' ? 'asc' : 'asc');
      return field;
    });
  }, []);

  const filteredSortedRows = useMemo((): RecipientRow[] => {
    const q = filter.trim().toLowerCase();
    let list: RecipientRow[] = rows.map((r) => ({
      ...r,
      alreadyRecipient: existingSet.has(r.team_id),
    }));

    if (q) {
      list = list.filter(
        (r) =>
          String(r.team_number).includes(q) ||
          r.team_name.toLowerCase().includes(q) ||
          (r.display_name?.toLowerCase().includes(q) ?? false),
      );
    }

    list = [...list].sort((a, b) => {
      switch (sortField) {
        case 'weighted': {
          if (sortDirection === 'asc') return compareByAwardLoad(a, b);
          const weightDiff = awardWeight(b) - awardWeight(a);
          if (weightDiff !== 0) return weightDiff;
          return a.team_number - b.team_number;
        }
        case 'team_number': {
          const cmp = compareNullableNumber(
            a.team_number,
            b.team_number,
            sortDirection,
          );
          return cmp !== 0 ? cmp : a.team_number - b.team_number;
        }
        case 'team_name': {
          const cmp = compareLocaleString(
            a.team_name,
            b.team_name,
            sortDirection,
          );
          return cmp !== 0 ? cmp : a.team_number - b.team_number;
        }
        case 'certificates': {
          const cmp = compareNullableNumber(
            a.certificate_count,
            b.certificate_count,
            sortDirection,
          );
          return cmp !== 0 ? cmp : a.team_number - b.team_number;
        }
        case 'trophies': {
          const cmp = compareNullableNumber(
            a.trophy_count,
            b.trophy_count,
            sortDirection,
          );
          return cmp !== 0 ? cmp : a.team_number - b.team_number;
        }
        default:
          return a.team_number - b.team_number;
      }
    });

    return list;
  }, [rows, existingSet, filter, sortField, sortDirection]);

  const columns = useMemo((): UnifiedColumnDef<RecipientRow>[] => {
    return [
      {
        kind: 'data',
        id: 'select',
        header: { full: 'Select' },
        headerStyle: { width: 40 },
        renderCell: (r) => (
          <input
            type="checkbox"
            checked={r.alreadyRecipient || selectedTeamIds.has(r.team_id)}
            disabled={r.alreadyRecipient}
            title={
              r.alreadyRecipient
                ? 'Already a recipient of this award'
                : undefined
            }
            onChange={(e) => {
              setSelectedTeamIds((prev) => {
                const next = new Set(prev);
                if (e.target.checked) {
                  next.add(r.team_id);
                } else {
                  next.delete(r.team_id);
                }
                return next;
              });
            }}
          />
        ),
      },
      {
        kind: 'data',
        id: 'team_number',
        sortable: true,
        header: { full: 'Team #' },
        renderCell: (r) => r.team_number,
      },
      {
        kind: 'data',
        id: 'team_name',
        sortable: true,
        header: { full: 'Team Name' },
        renderCell: (r) => r.team_name,
      },
      {
        kind: 'data',
        id: 'certificates',
        sortable: true,
        header: { full: 'Certificates' },
        renderCell: (r) => r.certificate_count,
      },
      {
        kind: 'data',
        id: 'trophies',
        sortable: true,
        header: { full: 'Trophies' },
        renderCell: (r) => r.trophy_count,
      },
      {
        kind: 'data',
        id: 'weighted',
        sortable: true,
        header: { full: 'Weighted' },
        title: 'Certificates + 2× trophies (least awarded first by default)',
        renderCell: (r) => awardWeight(r),
      },
    ];
  }, [selectedTeamIds]);

  const handleSubmit = async () => {
    if (selectedTeamIds.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/awards/event-awards/${awardId}/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ team_ids: Array.from(selectedTeamIds) }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Failed to add recipients');
      }
      onSuccess(
        selectedTeamIds.size === 1
          ? 'Recipient added'
          : `${selectedTeamIds.size} recipients added`,
      );
      await onAdded();
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add recipients');
    } finally {
      setSaving(false);
    }
  };

  const selectableCount = filteredSortedRows.filter(
    (r) => !r.alreadyRecipient,
  ).length;

  return (
    <div className="modal show" onClick={() => !saving && onClose()}>
      <div
        className="modal-content"
        style={{ maxWidth: '90vw', width: '800px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={() => !saving && onClose()}>
          &times;
        </span>
        <h3>Add team recipients</h3>
        <p
          style={{
            color: 'var(--secondary-color)',
            marginBottom: '1rem',
            lineHeight: 1.5,
          }}
        >
          Select teams for <strong>{awardName}</strong>. Sorted by weighted
          award load (trophy counts twice) so less-awarded teams appear first.
        </p>

        <div className="form-group award-recipient-filter">
          <label htmlFor="award-recipient-filter">Filter teams</label>
          <input
            id="award-recipient-filter"
            type="text"
            className="field-input"
            placeholder="Team # or name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {loading ? (
          <p style={{ color: 'var(--secondary-color)' }}>Loading teams…</p>
        ) : filteredSortedRows.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            {rows.length === 0
              ? 'No teams in this event.'
              : 'No teams match the filter.'}
          </p>
        ) : (
          <div
            className="table-responsive"
            style={{ maxHeight: '300px', overflow: 'auto' }}
          >
            <UnifiedTable
              columns={columns}
              rows={filteredSortedRows}
              getRowKey={(r) => r.team_id}
              activeSortId={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              rowClassName={(r) =>
                r.alreadyRecipient ? 'award-recipient-already' : ''
              }
              tableClassName="award-recipient-teams-table"
              headerLabelVariant="none"
              sortableHeaderClassName="sortable"
            />
          </div>
        )}

        <div className="award-recipient-modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              saving || selectedTeamIds.size === 0 || selectableCount === 0
            }
            onClick={() => void handleSubmit()}
          >
            {saving
              ? 'Adding…'
              : selectedTeamIds.size === 0
                ? 'Add teams'
                : `Add ${selectedTeamIds.size} team${selectedTeamIds.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
