import React, { useEffect, useState } from 'react';
import DriveLocationSelector from './DriveLocationSelector';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import './SpreadsheetsTab.css';

interface SheetConfig {
  id: number;
  spreadsheet_id: string;
  spreadsheet_name: string;
  sheet_name: string;
  sheet_purpose: string;
  is_active: boolean;
}

interface LinkedSpreadsheet {
  spreadsheet_id: string;
  spreadsheet_name: string;
  sheet_count: number;
  active_count: number;
}

interface AvailableSheet {
  title: string;
  sheetId: number;
  index: number;
}

export default function SpreadsheetsTab() {
  // Spreadsheets (first table)
  const [linkedSpreadsheets, setLinkedSpreadsheets] = useState<
    LinkedSpreadsheet[]
  >([]);
  const [selectedSpreadsheet, setSelectedSpreadsheet] =
    useState<LinkedSpreadsheet | null>(null);

  // Sheets for selected spreadsheet (second table)
  const [sheetConfigs, setSheetConfigs] = useState<SheetConfig[]>([]);
  const [availableSheets, setAvailableSheets] = useState<AvailableSheet[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);

  // Add sheet form
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [newSheetPurpose, setNewSheetPurpose] = useState('data');

  // Drive selector
  const [showDriveSelector, setShowDriveSelector] = useState(false);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  useEffect(() => {
    loadLinkedSpreadsheets();

    // Auto-refresh every 10 seconds to sync across all admins
    const interval = setInterval(() => {
      loadLinkedSpreadsheets();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Load unique spreadsheets (shared across all admins)
  const loadLinkedSpreadsheets = async () => {
    try {
      const response = await fetch('/admin/spreadsheets/grouped?shared=true', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load spreadsheets');
      const data = await response.json();
      setLinkedSpreadsheets(data);

      // If we had a selected spreadsheet, update it with fresh data
      if (selectedSpreadsheet) {
        const updated = data.find(
          (s: LinkedSpreadsheet) =>
            s.spreadsheet_id === selectedSpreadsheet.spreadsheet_id,
        );
        if (updated) {
          setSelectedSpreadsheet(updated);
        } else {
          // Spreadsheet was deleted
          setSelectedSpreadsheet(null);
          setSheetConfigs([]);
        }
      }
    } catch (error) {
      console.error('Error loading spreadsheets:', error);
    }
  };

  // Load sheet configs for selected spreadsheet (shared across all admins)
  const loadSheetConfigs = async (spreadsheetId: string) => {
    try {
      const response = await fetch(
        `/admin/spreadsheets/by-spreadsheet/${encodeURIComponent(spreadsheetId)}/configs?shared=true`,
        {
          credentials: 'include',
        },
      );
      if (!response.ok) throw new Error('Failed to load sheet configs');
      const data = await response.json();
      setSheetConfigs(data);
    } catch (error) {
      console.error('Error loading sheet configs:', error);
    }
  };

  // Load available sheets from Google for adding new ones
  const loadAvailableSheets = async (spreadsheetId: string) => {
    try {
      setLoadingSheets(true);
      const response = await fetch(
        `/admin/spreadsheets/${spreadsheetId}/sheets`,
        {
          credentials: 'include',
        },
      );
      if (!response.ok) throw new Error('Failed to load sheets');
      const data = await response.json();
      setAvailableSheets(
        data.sort((a: AvailableSheet, b: AvailableSheet) => a.index - b.index),
      );
    } catch (error) {
      console.error('Error loading available sheets:', error);
    } finally {
      setLoadingSheets(false);
    }
  };

  // Auto-refresh sheet configs when a spreadsheet is selected
  useEffect(() => {
    if (selectedSpreadsheet) {
      const interval = setInterval(() => {
        loadSheetConfigs(selectedSpreadsheet.spreadsheet_id);
      }, 10000);

      return () => clearInterval(interval);
    }
  }, [selectedSpreadsheet]);

  // Select a spreadsheet to view its sheets
  const handleSelectSpreadsheet = async (spreadsheet: LinkedSpreadsheet) => {
    setSelectedSpreadsheet(spreadsheet);
    setShowAddSheet(false);
    await loadSheetConfigs(spreadsheet.spreadsheet_id);
    await loadAvailableSheets(spreadsheet.spreadsheet_id);
  };

  // Deselect spreadsheet
  const handleBackToSpreadsheets = () => {
    setSelectedSpreadsheet(null);
    setSheetConfigs([]);
    setAvailableSheets([]);
    setShowAddSheet(false);
  };

  // Deactivate entire spreadsheet (all sheets) - shared across all admins
  const handleDeactivateSpreadsheet = async (spreadsheetId: string) => {
    try {
      const response = await fetch(
        `/admin/spreadsheets/by-spreadsheet/${encodeURIComponent(spreadsheetId)}/deactivate?shared=true`,
        {
          method: 'PUT',
          credentials: 'include',
        },
      );
      if (!response.ok) throw new Error('Failed to deactivate');
      await loadLinkedSpreadsheets();
      if (selectedSpreadsheet?.spreadsheet_id === spreadsheetId) {
        await loadSheetConfigs(spreadsheetId);
      }
    } catch (error) {
      console.error('Error deactivating spreadsheet:', error);
      toast.error('Failed to deactivate spreadsheet');
    }
  };

  // Delete entire spreadsheet (unlink) - shared across all admins
  const handleDeleteSpreadsheet = async (spreadsheetId: string) => {
    const confirmed = await confirm({
      title: 'Unlink Spreadsheet',
      message:
        'Are you sure you want to unlink this spreadsheet and all its sheet configurations? This will affect all admins.',
      confirmText: 'Unlink',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    try {
      const response = await fetch(
        `/admin/spreadsheets/by-spreadsheet/${encodeURIComponent(spreadsheetId)}?shared=true`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      if (!response.ok) throw new Error('Failed to delete');

      if (selectedSpreadsheet?.spreadsheet_id === spreadsheetId) {
        setSelectedSpreadsheet(null);
        setSheetConfigs([]);
      }
      await loadLinkedSpreadsheets();
    } catch (error) {
      console.error('Error deleting spreadsheet:', error);
      toast.error('Failed to delete spreadsheet');
    }
  };

  // Activate individual sheet
  const handleActivateSheet = async (id: number) => {
    try {
      const response = await fetch(`/admin/spreadsheets/${id}/activate`, {
        method: 'PUT',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to activate');
      await loadLinkedSpreadsheets();
      if (selectedSpreadsheet) {
        await loadSheetConfigs(selectedSpreadsheet.spreadsheet_id);
      }
    } catch (error) {
      console.error('Error activating sheet:', error);
      toast.error('Failed to activate sheet');
    }
  };

  // Deactivate individual sheet
  const handleDeactivateSheet = async (id: number) => {
    try {
      const response = await fetch(`/admin/spreadsheets/${id}/deactivate`, {
        method: 'PUT',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to deactivate');
      await loadLinkedSpreadsheets();
      if (selectedSpreadsheet) {
        await loadSheetConfigs(selectedSpreadsheet.spreadsheet_id);
      }
    } catch (error) {
      console.error('Error deactivating sheet:', error);
      toast.error('Failed to deactivate sheet');
    }
  };

  // Delete individual sheet config
  const handleDeleteSheet = async (id: number) => {
    const confirmed = await confirm({
      title: 'Remove Sheet Configuration',
      message: 'Are you sure you want to remove this sheet configuration?',
      confirmText: 'Remove',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/admin/spreadsheets/${id}?shared=true`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete');
      await loadLinkedSpreadsheets();
      if (selectedSpreadsheet) {
        await loadSheetConfigs(selectedSpreadsheet.spreadsheet_id);
      }
    } catch (error) {
      console.error('Error deleting sheet:', error);
      toast.error('Failed to delete sheet configuration');
    }
  };

  // Add a new sheet configuration (starts inactive)
  const handleAddSheet = async () => {
    if (!newSheetName || !newSheetPurpose || !selectedSpreadsheet) return;

    try {
      const response = await fetch('/admin/spreadsheets/link-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          spreadsheetId: selectedSpreadsheet.spreadsheet_id,
          sheetName: newSheetName,
          sheetPurpose: newSheetPurpose,
          isActive: true, // Start active so sheets work immediately
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add sheet');
      }

      setShowAddSheet(false);
      setNewSheetName('');
      setNewSheetPurpose('data');
      await loadLinkedSpreadsheets();
      await loadSheetConfigs(selectedSpreadsheet.spreadsheet_id);
    } catch (error: any) {
      console.error('Error adding sheet:', error);
      toast.error(error.message || 'Failed to add sheet configuration');
    }
  };

  // When a new spreadsheet is linked from Drive
  const handleSpreadsheetLinked = () => {
    setShowDriveSelector(false);
    loadLinkedSpreadsheets();
  };

  const getPurposeLabel = (purpose: string) => {
    switch (purpose) {
      case 'scores':
        return 'Score Submissions';
      case 'bracket':
        return 'DE Bracket';
      case 'data':
        return 'Data Source';
      default:
        return purpose;
    }
  };

  const getPurposeBadgeClass = (purpose: string) => {
    switch (purpose) {
      case 'scores':
        return 'badge-success';
      case 'bracket':
        return 'badge-primary';
      default:
        return 'badge-warning';
    }
  };

  // Filter out sheets that are already configured
  const getUnconfiguredSheets = () => {
    const configuredNames = new Set(sheetConfigs.map((c) => c.sheet_name));
    return availableSheets.filter((s) => !configuredNames.has(s.title));
  };

  return (
    <div>
      <h2>Google Spreadsheet Configuration</h2>

      {/* First Table: Linked Spreadsheets */}
      <div className="card">
        <h3>
          {selectedSpreadsheet ? (
            <>
              <button
                className="btn btn-secondary"
                onClick={handleBackToSpreadsheets}
                style={{ marginRight: '1rem' }}
              >
                ← Back
              </button>
              Sheets in "{selectedSpreadsheet.spreadsheet_name}"
            </>
          ) : (
            'Linked Spreadsheets'
          )}
        </h3>

        {!selectedSpreadsheet ? (
          // Show spreadsheets table
          <>
            {linkedSpreadsheets.length === 0 ? (
              <p>
                No spreadsheets linked yet. Click "Link New Spreadsheet" below
                to get started.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Spreadsheet Name</th>
                    <th>Configured Sheets</th>
                    <th>Active Sheets</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedSpreadsheets.map((spreadsheet) => (
                    <tr key={spreadsheet.spreadsheet_id}>
                      <td>
                        <button
                          className="btn-link"
                          onClick={() => handleSelectSpreadsheet(spreadsheet)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--primary-color)',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                            font: 'inherit',
                          }}
                        >
                          {spreadsheet.spreadsheet_name}
                        </button>
                      </td>
                      <td>{spreadsheet.sheet_count}</td>
                      <td>
                        {spreadsheet.active_count > 0 ? (
                          <span className="text-success">
                            {spreadsheet.active_count} active
                          </span>
                        ) : (
                          <span style={{ color: 'var(--secondary-color)' }}>
                            None active
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn-primary"
                          onClick={() => handleSelectSpreadsheet(spreadsheet)}
                          style={{ marginRight: '0.5rem' }}
                        >
                          Manage Sheets
                        </button>
                        {spreadsheet.active_count > 0 && (
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              handleDeactivateSpreadsheet(
                                spreadsheet.spreadsheet_id,
                              )
                            }
                            style={{ marginRight: '0.5rem' }}
                          >
                            Deactivate All
                          </button>
                        )}
                        <button
                          className="btn btn-danger"
                          onClick={() =>
                            handleDeleteSpreadsheet(spreadsheet.spreadsheet_id)
                          }
                        >
                          Unlink
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          // Show sheets table for selected spreadsheet
          <>
            {sheetConfigs.length === 0 ? (
              <p>
                No sheets configured yet. Add sheets below to activate them for
                specific purposes.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Sheet Name</th>
                    <th>Purpose</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetConfigs.map((config) => (
                    <tr key={config.id}>
                      <td>{config.sheet_name}</td>
                      <td>
                        <span
                          className={`badge ${getPurposeBadgeClass(config.sheet_purpose)}`}
                        >
                          {getPurposeLabel(config.sheet_purpose)}
                        </span>
                      </td>
                      <td>
                        {config.is_active ? (
                          <span className="text-success">Active</span>
                        ) : (
                          <span style={{ color: 'var(--secondary-color)' }}>
                            Inactive
                          </span>
                        )}
                      </td>
                      <td>
                        {config.is_active ? (
                          <button
                            className="btn btn-secondary"
                            onClick={() => handleDeactivateSheet(config.id)}
                            style={{ marginRight: '0.5rem' }}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary"
                            onClick={() => handleActivateSheet(config.id)}
                            style={{ marginRight: '0.5rem' }}
                          >
                            Activate
                          </button>
                        )}
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDeleteSheet(config.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Add Sheet Section */}
            <div
              style={{
                marginTop: '1.5rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border-color)',
              }}
            >
              {showAddSheet ? (
                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'flex-end',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: 'block',
                        marginBottom: '0.25rem',
                        fontSize: '0.875rem',
                      }}
                    >
                      Sheet
                    </label>
                    <select
                      className="field-input"
                      value={newSheetName}
                      onChange={(e) => setNewSheetName(e.target.value)}
                      style={{ minWidth: '200px' }}
                    >
                      <option value="">Select a sheet...</option>
                      {getUnconfiguredSheets().map((sheet) => (
                        <option key={sheet.sheetId} value={sheet.title}>
                          {sheet.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        marginBottom: '0.25rem',
                        fontSize: '0.875rem',
                      }}
                    >
                      Purpose
                    </label>
                    <select
                      className="field-input"
                      value={newSheetPurpose}
                      onChange={(e) => setNewSheetPurpose(e.target.value)}
                      style={{ minWidth: '180px' }}
                    >
                      <option value="data">Data Source</option>
                      <option value="scores">Score Submissions</option>
                      <option value="bracket">DE Bracket</option>
                    </select>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={handleAddSheet}
                    disabled={!newSheetName}
                  >
                    Add Sheet
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowAddSheet(false);
                      setNewSheetName('');
                      setNewSheetPurpose('data');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => setShowAddSheet(true)}
                  disabled={
                    loadingSheets || getUnconfiguredSheets().length === 0
                  }
                >
                  {loadingSheets ? 'Loading...' : '+ Add Sheet'}
                </button>
              )}
              {!loadingSheets &&
                getUnconfiguredSheets().length === 0 &&
                sheetConfigs.length > 0 && (
                  <p
                    style={{
                      marginTop: '0.5rem',
                      color: 'var(--secondary-color)',
                      fontSize: '0.875rem',
                    }}
                  >
                    All sheets in this spreadsheet have been configured.
                  </p>
                )}
            </div>
          </>
        )}
      </div>

      {/* Link New Spreadsheet Section */}
      {!selectedSpreadsheet && (
        <div className="card">
          <h3>Link New Spreadsheet</h3>
          <button
            className="btn btn-primary"
            onClick={() => setShowDriveSelector(!showDriveSelector)}
          >
            {showDriveSelector ? 'Hide' : 'Browse My Google Drive'}
          </button>
          {showDriveSelector && (
            <DriveLocationSelector
              onSpreadsheetLinked={handleSpreadsheetLinked}
              linkSpreadsheetOnly={true}
            />
          )}
        </div>
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
