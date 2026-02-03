import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { formatDateTime } from '../../utils/dateUtils';
import '../Modal.css';
import './TeamsTab.css';

interface Team {
  id: number;
  event_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  status: TeamStatus;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
}

type TeamStatus = 'registered' | 'checked_in' | 'no_show' | 'withdrawn';

interface TeamsTabProps {
  selectedEventId: number | null;
}

interface TeamFormData {
  team_number: string;
  team_name: string;
  display_name: string;
  status: TeamStatus;
}

const defaultFormData: TeamFormData = {
  team_number: '',
  team_name: '',
  display_name: '',
  status: 'registered',
};

type SortField =
  | 'team_number'
  | 'team_name'
  | 'display_name'
  | 'status'
  | 'checked_in_at';
type SortDirection = 'asc' | 'desc';

const STATUS_OPTIONS: { value: TeamStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'registered', label: 'Registered' },
  { value: 'checked_in', label: 'Checked In' },
  { value: 'no_show', label: 'No Show' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

const STATUS_LABELS: Record<TeamStatus, string> = {
  registered: 'Registered',
  checked_in: 'Checked In',
  no_show: 'No Show',
  withdrawn: 'Withdrawn',
};

function getStatusClass(status: TeamStatus): string {
  switch (status) {
    case 'checked_in':
      return 'status-checked-in';
    case 'registered':
      return 'status-registered';
    case 'no_show':
      return 'status-no-show';
    case 'withdrawn':
      return 'status-withdrawn';
    default:
      return '';
  }
}

interface BulkImportError {
  index: number;
  error: string;
}

interface ParsedTeam {
  team_number: number;
  team_name: string;
  display_name?: string;
  status?: TeamStatus;
}

function parseTeamsText(text: string): {
  teams: ParsedTeam[];
  errors: string[];
} {
  const lines = text
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const teams: ParsedTeam[] = [];
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let parts: string[];

    // Detect delimiter: tab, comma, or space
    if (line.includes('\t')) {
      parts = line.split('\t').map((p) => p.trim());
    } else if (line.includes(',')) {
      parts = line.split(',').map((p) => p.trim());
    } else {
      // Space-separated: first token is team_number, rest is team_name
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (match) {
        parts = [match[1], match[2]];
      } else {
        errors.push(`Line ${i + 1}: Invalid format "${line}"`);
        continue;
      }
    }

    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: Need at least team number and name`);
      continue;
    }

    const teamNumber = parseInt(parts[0], 10);
    if (isNaN(teamNumber) || teamNumber <= 0) {
      errors.push(`Line ${i + 1}: Invalid team number "${parts[0]}"`);
      continue;
    }

    const teamName = parts[1];
    if (!teamName) {
      errors.push(`Line ${i + 1}: Team name is required`);
      continue;
    }

    const team: ParsedTeam = {
      team_number: teamNumber,
      team_name: teamName,
    };

    // Optional display_name (3rd column)
    if (parts[2]) {
      team.display_name = parts[2];
    }

    // Optional status (4th column)
    if (parts[3]) {
      const status = parts[3].toLowerCase() as TeamStatus;
      if (
        ['registered', 'checked_in', 'no_show', 'withdrawn'].includes(status)
      ) {
        team.status = status;
      } else {
        errors.push(`Line ${i + 1}: Invalid status "${parts[3]}"`);
        continue;
      }
    }

    teams.push(team);
  }

  return { teams, errors };
}

export default function TeamsTab({ selectedEventId }: TeamsTabProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<TeamStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('team_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [formData, setFormData] = useState<TeamFormData>(defaultFormData);
  const [saving, setSaving] = useState(false);

  // Bulk import state
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkParsed, setBulkParsed] = useState<ParsedTeam[]>([]);
  const [bulkParseErrors, setBulkParseErrors] = useState<string[]>([]);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    created: number;
    errors: BulkImportError[];
  } | null>(null);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  // Fetch teams when event changes or filter changes
  const fetchTeams = useCallback(async () => {
    if (!selectedEventId) {
      setTeams([]);
      return;
    }

    setLoading(true);
    try {
      let url = `/teams/event/${selectedEventId}`;
      if (filterStatus !== 'all') {
        url += `?status=${filterStatus}`;
      }
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      const data: Team[] = await response.json();
      setTeams(data);
    } catch (error) {
      console.error('Error fetching teams:', error);
      toast.error('Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, [selectedEventId, filterStatus]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  // Filter and sort teams
  const filteredAndSortedTeams = useMemo(() => {
    let result = [...teams];

    // Client-side search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (team) =>
          team.team_number.toString().includes(query) ||
          team.team_name.toLowerCase().includes(query) ||
          (team.display_name &&
            team.display_name.toLowerCase().includes(query)),
      );
    }

    // Sort
    result.sort((a, b) => {
      let aVal: string | number | null;
      let bVal: string | number | null;

      switch (sortField) {
        case 'team_number':
          aVal = a.team_number;
          bVal = b.team_number;
          break;
        case 'team_name':
          aVal = a.team_name.toLowerCase();
          bVal = b.team_name.toLowerCase();
          break;
        case 'display_name':
          aVal = (a.display_name || '').toLowerCase();
          bVal = (b.display_name || '').toLowerCase();
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        case 'checked_in_at':
          aVal = a.checked_in_at || '';
          bVal = b.checked_in_at || '';
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [teams, searchQuery, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  // Modal handlers
  const handleCreateNew = () => {
    setEditingTeam(null);
    setFormData(defaultFormData);
    setShowModal(true);
  };

  const handleEdit = (team: Team) => {
    setEditingTeam(team);
    setFormData({
      team_number: team.team_number.toString(),
      team_name: team.team_name,
      display_name: team.display_name || '',
      status: team.status,
    });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingTeam(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const teamNumber = parseInt(formData.team_number, 10);
    if (isNaN(teamNumber) || teamNumber <= 0) {
      toast.error('Team number must be a positive integer');
      return;
    }

    if (!formData.team_name.trim()) {
      toast.error('Team name is required');
      return;
    }

    setSaving(true);
    try {
      const url = editingTeam ? `/teams/${editingTeam.id}` : '/teams';
      const method = editingTeam ? 'PATCH' : 'POST';

      const body: Record<string, unknown> = {
        team_number: teamNumber,
        team_name: formData.team_name.trim(),
        status: formData.status,
      };

      // Only include display_name if provided
      if (formData.display_name.trim()) {
        body.display_name = formData.display_name.trim();
      }

      // Include event_id for create
      if (!editingTeam) {
        body.event_id = selectedEventId;
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save team');
      }

      toast.success(editingTeam ? 'Team updated!' : 'Team created!');
      handleCloseModal();
      await fetchTeams();
    } catch (error) {
      console.error('Error saving team:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to save team',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCheckIn = async (team: Team) => {
    try {
      const response = await fetch(`/teams/${team.id}/check-in`, {
        method: 'PATCH',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to check in team');
      }

      toast.success(`Team ${team.team_number} checked in!`);
      await fetchTeams();
    } catch (error) {
      console.error('Error checking in team:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to check in team',
      );
    }
  };

  const handleDelete = async (team: Team) => {
    const confirmed = await confirm({
      title: 'Delete Team',
      message: `Are you sure you want to delete team ${team.team_number} "${team.team_name}"? This cannot be undone.`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    try {
      const response = await fetch(`/teams/${team.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok && response.status !== 204) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete team');
      }

      toast.success('Team deleted');
      await fetchTeams();
    } catch (error) {
      console.error('Error deleting team:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete team',
      );
    }
  };

  // Bulk import handlers
  const handleBulkTextChange = (text: string) => {
    setBulkText(text);
    setBulkResults(null);

    if (!text.trim()) {
      setBulkParsed([]);
      setBulkParseErrors([]);
      return;
    }

    const { teams: parsed, errors } = parseTeamsText(text);
    setBulkParsed(parsed);
    setBulkParseErrors(errors);
  };

  const handleBulkImport = async () => {
    if (bulkParsed.length === 0 || !selectedEventId) return;

    setBulkImporting(true);
    setBulkResults(null);

    try {
      const response = await fetch('/teams/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          event_id: selectedEventId,
          teams: bulkParsed,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to import teams');
      }

      const data = await response.json();
      setBulkResults({
        created: data.created,
        errors: data.errors || [],
      });

      if (data.created > 0) {
        toast.success(`Imported ${data.created} team(s)`);
        await fetchTeams();
      }

      if (data.errors && data.errors.length > 0) {
        toast.warning(`${data.errors.length} team(s) failed to import`);
      }
    } catch (error) {
      console.error('Error importing teams:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to import teams',
      );
    } finally {
      setBulkImporting(false);
    }
  };

  const handleCloseBulkImport = () => {
    setShowBulkImport(false);
    setBulkText('');
    setBulkParsed([]);
    setBulkParseErrors([]);
    setBulkResults(null);
  };

  if (!selectedEventId) {
    return (
      <div className="teams-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Please select an event from the dropdown above to manage teams.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="teams-tab">
      {/* Controls */}
      <div className="teams-controls">
        <div className="teams-controls-left">
          <button className="btn btn-primary" onClick={handleCreateNew}>
            + Add Team
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowBulkImport(true)}
          >
            Bulk Import
          </button>
        </div>
        <div className="teams-controls-right">
          <input
            type="text"
            className="field-input teams-search"
            placeholder="Search teams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="field-input teams-filter"
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as TeamStatus | 'all')
            }
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Teams table */}
      <div className="card">
        {loading ? (
          <p>Loading teams...</p>
        ) : filteredAndSortedTeams.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            {teams.length === 0
              ? 'No teams found for this event. Add a team or use bulk import.'
              : 'No teams match your search/filter criteria.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th
                  className="sortable"
                  onClick={() => handleSort('team_number')}
                >
                  Team #{getSortIndicator('team_number')}
                </th>
                <th
                  className="sortable"
                  onClick={() => handleSort('team_name')}
                >
                  Team Name{getSortIndicator('team_name')}
                </th>
                <th className="sortable" onClick={() => handleSort('status')}>
                  Status{getSortIndicator('status')}
                </th>
                <th
                  className="sortable"
                  onClick={() => handleSort('checked_in_at')}
                >
                  Checked In{getSortIndicator('checked_in_at')}
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedTeams.map((team) => (
                <tr key={team.id}>
                  <td>{team.team_number}</td>
                  <td>{team.team_name}</td>
                  <td>
                    <span
                      className={`team-status-badge ${getStatusClass(team.status)}`}
                    >
                      {STATUS_LABELS[team.status]}
                    </span>
                  </td>
                  <td>
                    {team.checked_in_at ? (
                      formatDateTime(team.checked_in_at)
                    ) : (
                      <em style={{ color: 'var(--secondary-color)' }}>—</em>
                    )}
                  </td>
                  <td>
                    <div className="team-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleEdit(team)}
                      >
                        Edit
                      </button>
                      {team.status !== 'checked_in' && (
                        <button
                          className="btn btn-success"
                          onClick={() => handleCheckIn(team)}
                        >
                          Check In
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDelete(team)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="teams-summary">
          {filteredAndSortedTeams.length} team
          {filteredAndSortedTeams.length !== 1 ? 's' : ''}
          {searchQuery || filterStatus !== 'all'
            ? ` (filtered from ${teams.length} total)`
            : ''}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal show" onClick={handleCloseModal}>
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={handleCloseModal}>
              &times;
            </span>
            <h3>{editingTeam ? 'Edit Team' : 'Add New Team'}</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              {editingTeam
                ? 'Update the team details below.'
                : 'Enter the details for the new team.'}
            </p>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="team-number">Team Number *</label>
                <input
                  id="team-number"
                  type="number"
                  className="field-input"
                  value={formData.team_number}
                  onChange={(e) =>
                    setFormData({ ...formData, team_number: e.target.value })
                  }
                  min={1}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="team-name">Team Name *</label>
                <input
                  id="team-name"
                  type="text"
                  className="field-input"
                  value={formData.team_name}
                  onChange={(e) =>
                    setFormData({ ...formData, team_name: e.target.value })
                  }
                  placeholder="e.g., Robo Warriors"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="display-name">Display Name</label>
                <input
                  id="display-name"
                  type="text"
                  className="field-input"
                  value={formData.display_name}
                  onChange={(e) =>
                    setFormData({ ...formData, display_name: e.target.value })
                  }
                  placeholder="Optional (defaults to 'team# team_name')"
                />
                <small style={{ color: 'var(--secondary-color)' }}>
                  Leave blank to auto-generate from team number and name
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="team-status">Status</label>
                <select
                  id="team-status"
                  className="field-input"
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      status: e.target.value as TeamStatus,
                    })
                  }
                >
                  {STATUS_OPTIONS.filter((opt) => opt.value !== 'all').map(
                    (opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ),
                  )}
                </select>
              </div>

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
                  onClick={handleCloseModal}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving...'
                    : editingTeam
                      ? 'Update Team'
                      : 'Add Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkImport && (
        <div className="modal show" onClick={handleCloseBulkImport}>
          <div
            className="modal-content"
            style={{ maxWidth: '700px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={handleCloseBulkImport}>
              &times;
            </span>
            <h3>Bulk Import Teams</h3>
            <p
              style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}
            >
              Paste team data below. Supports CSV, TSV, or space-separated
              format.
            </p>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1rem',
                fontSize: '0.875rem',
              }}
            >
              Format:{' '}
              <code>team_number, team_name [, display_name] [, status]</code>
            </p>

            <div className="form-group">
              <label htmlFor="bulk-text">Teams Data</label>
              <textarea
                id="bulk-text"
                className="field-input"
                rows={10}
                value={bulkText}
                onChange={(e) => handleBulkTextChange(e.target.value)}
                placeholder={`Example:\n101, Team Alpha\n102, Team Beta, The Beta Bots\n103, Team Gamma, , registered`}
              />
            </div>

            {/* Parse preview */}
            {bulkParsed.length > 0 && (
              <div className="bulk-preview">
                <h4>Preview ({bulkParsed.length} teams to import)</h4>
                <div className="bulk-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Team Name</th>
                        <th>Display Name</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkParsed.slice(0, 10).map((team, idx) => (
                        <tr key={idx}>
                          <td>{team.team_number}</td>
                          <td>{team.team_name}</td>
                          <td>{team.display_name || '—'}</td>
                          <td>{team.status || 'registered'}</td>
                        </tr>
                      ))}
                      {bulkParsed.length > 10 && (
                        <tr>
                          <td
                            colSpan={4}
                            style={{ textAlign: 'center', fontStyle: 'italic' }}
                          >
                            ...and {bulkParsed.length - 10} more
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Parse errors */}
            {bulkParseErrors.length > 0 && (
              <div className="bulk-errors">
                <h4>Parse Errors</h4>
                <ul>
                  {bulkParseErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Import results */}
            {bulkResults && (
              <div className="bulk-results">
                <h4>Import Results</h4>
                <p>
                  Successfully imported: <strong>{bulkResults.created}</strong>{' '}
                  team(s)
                </p>
                {bulkResults.errors.length > 0 && (
                  <>
                    <p>
                      Failed: <strong>{bulkResults.errors.length}</strong>{' '}
                      team(s)
                    </p>
                    <ul>
                      {bulkResults.errors.map((err) => (
                        <li key={err.index}>
                          Line {err.index + 1}: {err.error}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
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
                onClick={handleCloseBulkImport}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleBulkImport}
                disabled={bulkImporting || bulkParsed.length === 0}
              >
                {bulkImporting
                  ? 'Importing...'
                  : `Import ${bulkParsed.length} Team(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
