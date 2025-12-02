import React, { useEffect, useState } from 'react';
import '../Modal.css';

interface Sheet {
  title: string;
  sheetId: number;
  index: number;
}

interface SheetSelectionModalProps {
  spreadsheetId: string;
  spreadsheetName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SheetSelectionModal({ spreadsheetId, spreadsheetName, onClose, onSuccess }: SheetSelectionModalProps) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSheets();
  }, [spreadsheetId]);

  const loadSheets = async () => {
    try {
      const response = await fetch(`/admin/spreadsheets/${spreadsheetId}/sheets`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to load sheets');
      const data = await response.json();
      setSheets(data.sort((a: Sheet, b: Sheet) => a.index - b.index));
      if (data.length > 0) {
        setSelectedSheet(data[0].title);
      }
    } catch (error) {
      console.error('Error loading sheets:', error);
      alert('Failed to load sheets from spreadsheet');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedSheet) {
      alert('Please select a sheet');
      return;
    }

    try {
      const response = await fetch('/admin/spreadsheets/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ spreadsheetId, sheetName: selectedSheet })
      });

      if (!response.ok) throw new Error('Failed to link spreadsheet');

      showSuccessMessage('Spreadsheet linked successfully!');
      onSuccess();
    } catch (error) {
      console.error('Error linking spreadsheet:', error);
      alert('Failed to link spreadsheet');
    }
  };

  const showSuccessMessage = (message: string) => {
    const messageDiv = document.createElement('div');
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: var(--success-color);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      box-shadow: var(--shadow-lg);
      z-index: 2000;
    `;
    document.body.appendChild(messageDiv);
    setTimeout(() => messageDiv.remove(), 3000);
  };

  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose}>&times;</span>
        <h3>Select Sheet</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
          Spreadsheet: {spreadsheetName}
        </p>
        <div className="form-group">
          <label>Choose a sheet from the spreadsheet:</label>
          {loading ? (
            <p>Loading sheets...</p>
          ) : (
            <select
              className="field-input"
              value={selectedSheet}
              onChange={(e) => setSelectedSheet(e.target.value)}
            >
              {sheets.map(sheet => (
                <option key={sheet.sheetId} value={sheet.title}>
                  {sheet.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            Link Spreadsheet
          </button>
        </div>
      </div>
    </div>
  );
}

