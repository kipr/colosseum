import React, { useEffect, useState } from 'react';
import SheetSelectionModal from './SheetSelectionModal';

interface DriveLocation {
  id: string;
  name: string;
  type: string;
}

interface Spreadsheet {
  id: string;
  name: string;
  modifiedTime: string;
}

interface DriveLocationSelectorProps {
  onSpreadsheetLinked: () => void;
}

export default function DriveLocationSelector({ onSpreadsheetLinked }: DriveLocationSelectorProps) {
  const [locations, setLocations] = useState<DriveLocation[]>([]);
  const [spreadsheets, setSpreadsheets] = useState<Spreadsheet[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<DriveLocation | null>(null);
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLocations();
  }, []);

  const loadLocations = async () => {
    try {
      const response = await fetch('/admin/drive/locations', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load locations');
      const data = await response.json();
      setLocations(data);
    } catch (error) {
      console.error('Error loading locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLocationSelect = async (location: DriveLocation) => {
    setSelectedLocation(location);
    setLoading(true);
    try {
      const url = `/admin/drive/spreadsheets?driveId=${encodeURIComponent(location.id)}&driveType=${encodeURIComponent(location.type)}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load spreadsheets');
      const data = await response.json();
      setSpreadsheets(data);
    } catch (error) {
      console.error('Error loading spreadsheets:', error);
      alert('Failed to load spreadsheets from this location');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setSelectedLocation(null);
    setSpreadsheets([]);
  };

  const handleSpreadsheetSelect = (id: string, name: string) => {
    setSelectedSpreadsheet({ id, name });
  };

  if (loading && !selectedLocation) {
    return <div style={{ marginTop: '1rem' }}>Loading...</div>;
  }

  if (!selectedLocation) {
    return (
      <div style={{ marginTop: '1rem' }}>
        <h4>Select a Location</h4>
        <div className="card" style={{ padding: 0 }}>
          {locations.map(location => (
            <div
              key={location.id}
              className="drive-location-item"
              onClick={() => handleLocationSelect(location)}
            >
              <span style={{ fontSize: '1.1rem' }}>{location.name}</span>
              <span style={{ color: 'var(--secondary-color)' }}>→</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <button className="btn btn-secondary" onClick={handleBack} style={{ marginBottom: '1rem' }}>
        ← Back to Locations
      </button>
      <h4>Spreadsheets in {selectedLocation.name}</h4>
      {loading ? (
        <p>Loading spreadsheets...</p>
      ) : spreadsheets.length === 0 ? (
        <p>No spreadsheets found in {selectedLocation.name}.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Modified</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {spreadsheets.map(sheet => (
              <tr key={sheet.id}>
                <td>{sheet.name}</td>
                <td>{new Date(sheet.modifiedTime).toLocaleString()}</td>
                <td>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleSpreadsheetSelect(sheet.id, sheet.name)}
                  >
                    Link
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedSpreadsheet && (
        <SheetSelectionModal
          spreadsheetId={selectedSpreadsheet.id}
          spreadsheetName={selectedSpreadsheet.name}
          onClose={() => setSelectedSpreadsheet(null)}
          onSuccess={onSpreadsheetLinked}
        />
      )}
    </div>
  );
}

