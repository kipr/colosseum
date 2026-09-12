import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { overallQueryOptions } from '../../queries/events';
import QueryFeedback, { queryData } from '../QueryFeedback';
import OverallScoresDisplay from '../overall/OverallScoresDisplay';
import type { OverallRow } from '../../api/events';
import './DocumentationTab.css';

const EMPTY_ROWS: OverallRow[] = [];

export default function OverallTab() {
  const { selectedEvent } = useEvent();
  const { user, loading: authLoading } = useAuth();
  const selectedEventId = selectedEvent?.id ?? null;
  const rowsQuery = useQuery({
    ...overallQueryOptions(user?.id ?? 0, selectedEventId ?? 0),
    enabled: Boolean(user && !authLoading && selectedEventId),
  });
  const rows = queryData(rowsQuery) ?? EMPTY_ROWS;

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
      <QueryFeedback query={rowsQuery} />
      <OverallScoresDisplay
        rows={rows}
        showDoubleSeeding={(selectedEvent?.double_seeding_rounds ?? 0) > 0}
      />
    </div>
  );
}
