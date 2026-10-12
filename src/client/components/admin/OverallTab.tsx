import { useEvent } from '../../contexts/EventContext';
import { useToast } from '../Toast';
import OverallScoresDisplay from '../overall/OverallScoresDisplay';
import type { OverallRow } from '../overall/OverallScoresDisplay';
import { apiFetch } from '../../utils/api';
import { useScopedLoad } from '../../hooks/useScopedLoad';
import './DocumentationTab.css';

export default function OverallTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const toast = useToast();

  const { data: rows, loading } = useScopedLoad(
    selectedEventId,
    (eventId, signal) =>
      apiFetch<OverallRow[]>(`/events/${eventId}/overall`, {
        signal,
        fallbackError: 'Failed to fetch overall scores',
      }),
    {
      initial: [],
      onError: (err) => {
        console.error(err);
        toast.error(
          err instanceof Error ? err.message : 'Failed to load overall scores',
        );
      },
    },
  );

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
      <OverallScoresDisplay
        rows={rows}
        showDoubleSeeding={(selectedEvent?.double_seeding_rounds ?? 0) > 0}
      />
    </div>
  );
}
