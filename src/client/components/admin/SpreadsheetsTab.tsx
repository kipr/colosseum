import React, { useEffect, useState } from 'react';
import DriveLocationSelector from './DriveLocationSelector';

interface SpreadsheetConfig {
  id: number;
  spreadsheet_name: string;
  sheet_name: string;
  sheet_purpose: string;
  is_active: boolean;
}

export default function SpreadsheetsTab() {
  const [linkedSpreadsheets, setLinkedSpreadsheets] = useState<SpreadsheetConfig[]>([]);
  const [showDriveSelector, setShowDriveSelector] = useState(false);

  useEffect(() => {
    loadLinkedSpreadsheets();
  }, []);

  const loadLinkedSpreadsheets = async () => {
    try {
      const response = await fetch('/admin/spreadsheets', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load spreadsheets');
      const data = await response.json();
      setLinkedSpreadsheets(data);
    } catch (error) {
      console.error('Error loading spreadsheets:', error);
    }
  };

  const handleActivate = async (id: number) => {
    try {
      const response = await fetch(`/admin/spreadsheets/${id}/activate`, {
        method: 'PUT',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to activate');
      await loadLinkedSpreadsheets();
    } catch (error) {
      console.error('Error activating spreadsheet:', error);
      alert('Failed to activate spreadsheet');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this spreadsheet configuration?')) return;

    try {
      const response = await fetch(`/admin/spreadsheets/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to delete');
      await loadLinkedSpreadsheets();
    } catch (error) {
      console.error('Error deleting spreadsheet:', error);
      alert('Failed to delete spreadsheet');
    }
  };

  const handleSpreadsheetLinked = () => {
    setShowDriveSelector(false);
    loadLinkedSpreadsheets();
  };

  return (
    <div>
      <h2>Google Spreadsheet Configuration</h2>

      <div className="card">
        <h3>Linked Spreadsheets</h3>
        {linkedSpreadsheets.length === 0 ? (
          <p>No spreadsheets linked yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Spreadsheet</th>
                <th>Sheet</th>
                <th>Purpose</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {linkedSpreadsheets.map(sheet => (
                <tr key={sheet.id}>
                  <td>{sheet.spreadsheet_name}</td>
                  <td>{sheet.sheet_name}</td>
                  <td>
                    <span className={`badge ${
                      sheet.sheet_purpose === 'scores' ? 'badge-success' : 
                      sheet.sheet_purpose === 'bracket' ? 'badge-primary' : 
                      'badge-warning'
                    }`}>
                      {sheet.sheet_purpose === 'scores' ? 'Score Submissions' : 
                       sheet.sheet_purpose === 'bracket' ? 'DE Bracket' : 
                       'Data Source'}
                    </span>
                  </td>
                  <td>
                    {sheet.is_active ? (
                      <span className="text-success">Active</span>
                    ) : (
                      'Inactive'
                    )}
                  </td>
                  <td>
                    {!sheet.is_active && (
                      <button className="btn btn-primary" onClick={() => handleActivate(sheet.id)}>
                        Activate
                      </button>
                    )}
                    <button className="btn btn-danger" onClick={() => handleDelete(sheet.id)} style={{ marginLeft: '0.5rem' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Link New Spreadsheet</h3>
        <button className="btn btn-primary" onClick={() => setShowDriveSelector(!showDriveSelector)}>
          {showDriveSelector ? 'Hide' : 'Browse My Google Drive'}
        </button>
        {showDriveSelector && (
          <DriveLocationSelector onSpreadsheetLinked={handleSpreadsheetLinked} />
        )}
      </div>
    </div>
  );
}

