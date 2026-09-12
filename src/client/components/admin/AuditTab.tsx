import { useState, useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import { useSearchParams } from 'react-router-dom';
import * as Diff from 'diff';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { useToast } from '../Toast';
import { formatDateTime } from '../../utils/dateUtils';
import type { AuditLogEntry } from '../../api/audit';
import {
  AUDIT_PAGE_SIZE,
  auditHistoryQueryOptions,
  entityHistoryQueryOptions,
} from '../../queries/audit';
import QueryFeedback from '../QueryFeedback';
import { isAuthorizationError } from '../../queries/invalidation';
import '../Modal.css';
import './AuditTab.css';

const EMPTY_LOGS: AuditLogEntry[] = [];

import type { AdminView } from '../../utils/routes';

interface AuditTabProps {
  onNavigateTab: (tab: AdminView) => void;
}

function formatUserDisplay(entry: AuditLogEntry): string {
  if (entry.user_name) return entry.user_name;
  if (entry.user_email) return entry.user_email;
  if (entry.user_id) return `User #${entry.user_id}`;
  return '-';
}

function summarizeValue(value: string | null): string {
  if (!value) return '-';
  try {
    const parsed = JSON.parse(value);
    const str = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    return str.length > 80 ? str.slice(0, 80) + '…' : str;
  } catch {
    return value.length > 80 ? value.slice(0, 80) + '…' : value;
  }
}

const ENTITY_TYPE_TO_TAB: Record<string, AdminView> = {
  team: 'teams',
  teams: 'teams',
  bracket: 'brackets',
  bracket_game: 'brackets',
  bracket_games: 'brackets',
  score: 'scoring',
  score_submission: 'scoring',
  score_submissions: 'scoring',
  seeding_score: 'seeding',
  seeding_scores: 'seeding',
  game_queue: 'queue',
  event: 'events',
  events: 'events',
};

export default function AuditTab({ onNavigateTab }: AuditTabProps) {
  const { selectedEvent } = useEvent();
  const { user, loading: authLoading } = useAuth();
  const selectedEventId = selectedEvent?.id ?? null;
  const toast = useToast();

  const [, setSearchParams] = useSearchParams();

  const [filterAction, setFilterAction] = useState('');
  const [filterEntityType, setFilterEntityType] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedEntityType, setAppliedEntityType] = useState('');

  const setUrlPage = useCallback(
    (page: number) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (page <= 1) {
            p.delete('audit_page');
          } else {
            p.set('audit_page', String(page));
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [jsonModal, setJsonModal] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const [historyModal, setHistoryModal] = useState<{
    entityType: string;
    entityId: number;
  } | null>(null);
  const [diffModal, setDiffModal] = useState<{
    oldValue: string | null;
    newValue: string | null;
  } | null>(null);

  const historyQuery = useInfiniteQuery({
    ...auditHistoryQueryOptions(
      user?.id ?? 0,
      selectedEventId ?? 0,
      { action: appliedAction, entityType: appliedEntityType },
      AUDIT_PAGE_SIZE,
    ),
    enabled: Boolean(user && !authLoading && selectedEventId),
  });
  const logs = isAuthorizationError(historyQuery.error)
    ? EMPTY_LOGS
    : (historyQuery.data?.pages.flat() ?? EMPTY_LOGS);
  const loading = historyQuery.isLoading;
  const loadingMore = historyQuery.isFetchingNextPage;
  const hasMore = Boolean(historyQuery.hasNextPage);

  const handleLoadMore = () => {
    if (loadingMore || !historyQuery.hasNextPage) return;
    const nextPage = (historyQuery.data?.pages.length ?? 0) + 1;
    setUrlPage(nextPage);
    void historyQuery.fetchNextPage();
  };

  const handleApplyFilters = () => {
    setAppliedAction(filterAction.trim());
    setAppliedEntityType(filterEntityType.trim());
    setUrlPage(1);
  };

  const handleClearFilters = () => {
    setFilterAction('');
    setFilterEntityType('');
    setAppliedAction('');
    setUrlPage(1);
    setAppliedEntityType('');
  };

  const handleJumpToTab = (entityType: string, entityId: number) => {
    const tab = ENTITY_TYPE_TO_TAB[entityType];
    if (tab) {
      onNavigateTab(tab);
      toast.success(`Switched to ${tab} tab (${entityType} #${entityId})`);
    } else {
      toast.error(`No tab mapping for entity type "${entityType}"`);
    }
  };

  const auditLogColumns: UnifiedColumnDef<AuditLogEntry>[] = [
    {
      kind: 'data',
      id: 'timestamp',
      header: { full: 'Timestamp' },
      renderCell: (entry) => formatDateTime(entry.created_at),
    },
    {
      kind: 'data',
      id: 'action',
      header: { full: 'Action' },
      renderCell: (entry) => entry.action,
    },
    {
      kind: 'data',
      id: 'entity_type',
      header: { full: 'Entity Type' },
      renderCell: (entry) => entry.entity_type,
    },
    {
      kind: 'data',
      id: 'entity_id',
      header: { full: 'Entity ID' },
      renderCell: (entry) => entry.entity_id ?? '-',
    },
    {
      kind: 'data',
      id: 'user',
      header: { full: 'User' },
      renderCell: (entry) => formatUserDisplay(entry),
    },
    {
      kind: 'data',
      id: 'old_value',
      header: { full: 'Old Value' },
      cellClassName: 'audit-value-cell',
      renderCell: (entry) => (
        <>
          <span className="audit-value-text">
            {summarizeValue(entry.old_value)}
          </span>
          {entry.old_value != null && entry.old_value !== '' && (
            <button
              type="button"
              className="btn-link audit-view-btn"
              onClick={() =>
                setJsonModal({
                  label: 'Old Value',
                  value: entry.old_value ?? '',
                })
              }
            >
              View
            </button>
          )}
        </>
      ),
    },
    {
      kind: 'data',
      id: 'new_value',
      header: { full: 'New Value' },
      cellClassName: 'audit-value-cell',
      renderCell: (entry) => (
        <>
          <span className="audit-value-text">
            {summarizeValue(entry.new_value)}
          </span>
          {entry.new_value != null && entry.new_value !== '' && (
            <button
              type="button"
              className="btn-link audit-view-btn"
              onClick={() =>
                setJsonModal({
                  label: 'New Value',
                  value: entry.new_value ?? '',
                })
              }
            >
              View
            </button>
          )}
        </>
      ),
    },
    {
      kind: 'data',
      id: 'row_actions',
      header: { full: 'Actions' },
      renderCell: (entry) => (
        <>
          {(entry.old_value != null && entry.old_value !== '') ||
          (entry.new_value != null && entry.new_value !== '') ? (
            <button
              type="button"
              className="btn-link audit-action-btn"
              onClick={() =>
                setDiffModal({
                  oldValue: entry.old_value,
                  newValue: entry.new_value,
                })
              }
            >
              Diff
            </button>
          ) : null}
          {entry.entity_type && entry.entity_id != null && (
            <>
              <button
                type="button"
                className="btn-link audit-action-btn"
                onClick={() =>
                  setHistoryModal({
                    entityType: entry.entity_type,
                    entityId: entry.entity_id!,
                  })
                }
              >
                History
              </button>
              <button
                type="button"
                className="btn-link audit-action-btn"
                onClick={() =>
                  handleJumpToTab(entry.entity_type, entry.entity_id!)
                }
              >
                Go to tab
              </button>
            </>
          )}
        </>
      ),
    },
  ];

  if (!selectedEventId) {
    return (
      <div className="audit-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to view the audit log.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="audit-tab">
      <div className="audit-controls">
        <div className="audit-controls-left">
          <input
            type="text"
            className="field-input audit-filter-input"
            placeholder="Filter by action"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          />
          <input
            type="text"
            className="field-input audit-filter-input"
            placeholder="Filter by entity type"
            value={filterEntityType}
            onChange={(e) => setFilterEntityType(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleApplyFilters}>
            Apply
          </button>
          <button className="btn btn-secondary" onClick={handleClearFilters}>
            Clear
          </button>
        </div>
      </div>

      <div className="card audit-table-card">
        {historyQuery.isError ? (
          <div className="lookup-status-banner" role="alert">
            <p>
              {historyQuery.data === undefined
                ? 'Unable to load data.'
                : 'Unable to refresh data.'}{' '}
              {historyQuery.error.message}
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void historyQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : null}
        {loading && logs.length === 0 ? (
          <p>Loading...</p>
        ) : logs.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            No audit entries found.
          </p>
        ) : (
          <>
            <UnifiedTable
              wrapperClassName="audit-table-wrapper"
              columns={auditLogColumns}
              rows={logs}
              getRowKey={(entry) => entry.id}
              headerLabelVariant="none"
              tableClassName="audit-table"
              highlightActiveColumn={false}
            />
            {hasMore && (
              <div className="audit-load-more">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {jsonModal && (
        <JsonViewModal
          label={jsonModal.label}
          value={jsonModal.value}
          onClose={() => setJsonModal(null)}
        />
      )}

      {historyModal && (
        <EntityHistoryModal
          entityType={historyModal.entityType}
          entityId={historyModal.entityId}
          onClose={() => setHistoryModal(null)}
        />
      )}

      {diffModal && (
        <DiffModal
          oldValue={diffModal.oldValue}
          newValue={diffModal.newValue}
          onClose={() => setDiffModal(null)}
        />
      )}
    </div>
  );
}

function formatForDiff(value: string | null): string {
  if (value == null || value === '') return '';
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(normalizeNestedJson(parsed), null, 2);
  } catch {
    return value;
  }
}

function parseJsonLikeString(value: string): unknown {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeNestedJson(value: unknown): unknown {
  if (typeof value === 'string') {
    const parsed = parseJsonLikeString(value);
    if (parsed !== value) {
      return normalizeNestedJson(parsed);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJson(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, child]) => [
      key,
      normalizeNestedJson(child),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

function DiffModal({
  oldValue,
  newValue,
  onClose,
}: {
  oldValue: string | null;
  newValue: string | null;
  onClose: () => void;
}) {
  const diff = useMemo(() => {
    const oldStr = formatForDiff(oldValue);
    const newStr = formatForDiff(newValue);
    return Diff.diffLines(oldStr || '', newStr || '');
  }, [oldValue, newValue]);

  return (
    <div className="modal show" onClick={onClose}>
      <div
        className="modal-content audit-diff-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onClose} aria-label="Close">
          &times;
        </span>
        <h3>Diff: Old → New</h3>
        <pre className="audit-diff-view">
          {diff.length === 0 ? (
            <span className="audit-diff-unchanged">(no changes)</span>
          ) : (
            diff.map((part, i) => {
              const key = `${i}-${part.added ? 'add' : part.removed ? 'rem' : 'unch'}`;
              const className = part.added
                ? 'audit-diff-added'
                : part.removed
                  ? 'audit-diff-removed'
                  : 'audit-diff-unchanged';
              return (
                <span key={key} className={className}>
                  {part.value}
                </span>
              );
            })
          )}
        </pre>
      </div>
    </div>
  );
}

function JsonViewModal({
  label,
  value,
  onClose,
}: {
  label: string;
  value: string;
  onClose: () => void;
}) {
  let displayValue = value;
  try {
    const parsed = JSON.parse(value);
    displayValue = JSON.stringify(normalizeNestedJson(parsed), null, 2);
  } catch {
    // Use raw value
  }
  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose} aria-label="Close">
          &times;
        </span>
        <h3>{label}</h3>
        <pre className="audit-json-view">{displayValue || '(empty)'}</pre>
      </div>
    </div>
  );
}

function EntityHistoryModal({
  entityType,
  entityId,
  onClose,
}: {
  entityType: string;
  entityId: number;
  onClose: () => void;
}) {
  const { user, loading: authLoading } = useAuth();
  const historyQuery = useQuery({
    ...entityHistoryQueryOptions(user?.id ?? 0, entityType, entityId),
    enabled: Boolean(user && !authLoading),
  });
  const logs = isAuthorizationError(historyQuery.error)
    ? EMPTY_LOGS
    : (historyQuery.data ?? EMPTY_LOGS);

  const historyColumns: UnifiedColumnDef<AuditLogEntry>[] = [
    {
      kind: 'data',
      id: 'timestamp',
      header: { full: 'Timestamp' },
      renderCell: (entry) => formatDateTime(entry.created_at),
    },
    {
      kind: 'data',
      id: 'action',
      header: { full: 'Action' },
      renderCell: (entry) => entry.action,
    },
    {
      kind: 'data',
      id: 'user',
      header: { full: 'User' },
      renderCell: (entry) => formatUserDisplay(entry),
    },
    {
      kind: 'data',
      id: 'summary',
      header: { full: 'Summary' },
      cellClassName: 'audit-value-cell',
      renderCell: (entry) => (
        <span className="audit-value-text">
          {summarizeValue(entry.old_value)} → {summarizeValue(entry.new_value)}
        </span>
      ),
    },
  ];

  return (
    <div className="modal show" onClick={onClose}>
      <div
        className="modal-content audit-history-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onClose} aria-label="Close">
          &times;
        </span>
        <h3>
          Audit history: {entityType} #{entityId}
        </h3>
        {historyQuery.isError ? (
          <QueryFeedback query={historyQuery} />
        ) : historyQuery.isLoading ? (
          <p>Loading...</p>
        ) : logs.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            No history found for this entity.
          </p>
        ) : (
          <UnifiedTable
            wrapperClassName="audit-table-wrapper"
            columns={historyColumns}
            rows={logs}
            getRowKey={(entry) => entry.id}
            headerLabelVariant="none"
            tableClassName="audit-table"
            highlightActiveColumn={false}
          />
        )}
      </div>
    </div>
  );
}
