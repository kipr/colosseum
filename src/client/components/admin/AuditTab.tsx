import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import * as Diff from 'diff';
import { useEvent } from '../../contexts/EventContext';
import { useToast } from '../Toast';
import { formatDateTime } from '../../utils/dateUtils';
import '../Modal.css';
import './AuditTab.css';

const PAGE_SIZE = 50;

interface AuditLogEntry {
  id: number;
  event_id: number | null;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

type TabType =
  | 'events'
  | 'teams'
  | 'spreadsheets'
  | 'scoresheets'
  | 'scoring'
  | 'seeding'
  | 'brackets'
  | 'queue'
  | 'admins'
  | 'audit';

interface AuditTabProps {
  onNavigateTab: (tab: TabType) => void;
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

const ENTITY_TYPE_TO_TAB: Record<string, TabType> = {
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
  const selectedEventId = selectedEvent?.id ?? null;
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const fetchGenerationRef = useRef(0);

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [filterEntityType, setFilterEntityType] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedEntityType, setAppliedEntityType] = useState('');

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

  const fetchLogs = useCallback(
    async (append: boolean, fetchOffset?: number, signal?: AbortSignal) => {
      if (!selectedEventId) {
        setLogs([]);
        return;
      }

      if (!append) {
        fetchGenerationRef.current += 1;
      }
      const currentGen = fetchGenerationRef.current;

      const currentOffset =
        append && fetchOffset !== undefined ? fetchOffset : 0;
      setLoading(true);
      if (!append) {
        setLogs([]);
        setOffset(0);
      }

      try {
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(currentOffset));
        if (appliedAction) params.set('action', appliedAction);
        if (appliedEntityType) params.set('entity_type', appliedEntityType);

        const url = `/audit/event/${selectedEventId}?${params.toString()}`;
        const response = await fetch(url, {
          credentials: 'include',
          signal,
        });
        if (!response.ok) throw new Error('Failed to fetch audit log');
        const data: AuditLogEntry[] = await response.json();

        if (currentGen !== fetchGenerationRef.current) return;

        if (append) {
          setLogs((prev) => [...prev, ...data]);
        } else {
          setLogs(data);
        }
        setHasMore(data.length === PAGE_SIZE);
        setOffset(currentOffset + data.length);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        if (currentGen !== fetchGenerationRef.current) return;
        console.error('Error fetching audit log:', error);
        toastRef.current.error('Failed to load audit log');
        if (!append) setLogs([]);
      } finally {
        if (currentGen === fetchGenerationRef.current && !signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [selectedEventId, appliedAction, appliedEntityType],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchLogs(false, undefined, controller.signal);
    return () => controller.abort();
  }, [selectedEventId, appliedAction, appliedEntityType, fetchLogs]);

  const handleLoadMore = () => {
    fetchLogs(true, offset);
  };

  const handleApplyFilters = () => {
    setAppliedAction(filterAction.trim());
    setAppliedEntityType(filterEntityType.trim());
  };

  const handleClearFilters = () => {
    setFilterAction('');
    setFilterEntityType('');
    setAppliedAction('');
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
        {loading && logs.length === 0 ? (
          <p>Loading...</p>
        ) : logs.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            No audit entries found.
          </p>
        ) : (
          <>
            <div className="audit-table-wrapper">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Entity Type</th>
                    <th>Entity ID</th>
                    <th>User</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.created_at)}</td>
                      <td>{entry.action}</td>
                      <td>{entry.entity_type}</td>
                      <td>{entry.entity_id ?? '-'}</td>
                      <td>{formatUserDisplay(entry)}</td>
                      <td className="audit-value-cell">
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
                      </td>
                      <td className="audit-value-cell">
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
                      </td>
                      <td>
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
                                handleJumpToTab(
                                  entry.entity_type,
                                  entry.entity_id!,
                                )
                              }
                            >
                              Go to tab
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hasMore && (
              <div className="audit-load-more">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load more'}
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
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
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
    displayValue = JSON.stringify(parsed, null, 2);
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
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const url = `/audit/entity/${encodeURIComponent(entityType)}/${entityId}?limit=50`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch');
        const data: AuditLogEntry[] = await response.json();
        if (!cancelled) setLogs(data);
      } catch (error) {
        console.error('Error fetching entity audit:', error);
        if (!cancelled) setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

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
        {loading ? (
          <p>Loading...</p>
        ) : logs.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            No history found for this entity.
          </p>
        ) : (
          <div className="audit-table-wrapper">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>User</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.created_at)}</td>
                    <td>{entry.action}</td>
                    <td>{formatUserDisplay(entry)}</td>
                    <td className="audit-value-cell">
                      <span className="audit-value-text">
                        {summarizeValue(entry.old_value)} →{' '}
                        {summarizeValue(entry.new_value)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
