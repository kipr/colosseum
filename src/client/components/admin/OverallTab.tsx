import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEvent } from '../../contexts/EventContext';
import { useToast } from '../Toast';
import OverallScoresDisplay from '../overall/OverallScoresDisplay';
import type { OverallScoreRow } from '../../../shared/api';
import './DocumentationTab.css';

export default function OverallTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const [rows, setRows] = useState<readonly OverallScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadAll = useCallback(async () => {
    if (!selectedEventId) {
      setRows([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/events/${selectedEventId}/overall`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch overall scores');
      const data = await res.json();
      setRows(data);
    } catch (err) {
      console.error(err);
      toastRef.current.error(
        err instanceof Error ? err.message : 'Failed to load overall scores',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (!selectedEventId) {
    return (
      <div className="documentation-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to view overall scores.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="documentation-tab">
      {loading && <p style={{ color: 'var(--secondary-color)' }}>Loading...</p>}
      <OverallScoresDisplay rows={rows} />
    </div>
  );
}
