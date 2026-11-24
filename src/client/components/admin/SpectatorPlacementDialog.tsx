import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal';
import SeasonPicker from './SeasonPicker';
import type { SeasonCatalog } from '../../hooks/useSeasons';
import type { Event } from '../../utils/eventStatus';
import { apiFetch } from '../../utils/api';
import { useEvent } from '../../contexts/EventContext';

interface SpectatorPlacementDialogProps {
  event: Event;
  catalog: SeasonCatalog;
  onClose: () => void;
  onPersisted: (event: Event) => void;
  onSaved: (event: Event) => void;
}

export default function SpectatorPlacementDialog({
  event,
  catalog,
  onClose,
  onPersisted,
  onSaved,
}: SpectatorPlacementDialogProps) {
  const { beginEventMutation } = useEvent();
  const returning = event.spectator_listing === 'archive';
  const title = returning
    ? 'Return to Current Events'
    : 'Move to Spectator Archive';
  const [seasonId, setSeasonId] = useState(event.season_id);
  const [saving, setSaving] = useState(false);
  const [creatingSeason, setCreatingSeason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async () => {
    if (pending.current || creatingSeason) return;
    if (!returning && seasonId === null) {
      setError('Select or create a season before moving this event.');
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const reconcileEvent = beginEventMutation();
      const saved = await apiFetch<Event>(`/events/${event.id}`, {
        method: 'PATCH',
        body: returning
          ? { spectator_listing: 'current' }
          : { spectator_listing: 'archive', season_id: seasonId },
        fallbackError: 'Could not update spectator placement',
      });
      // Keep the persistent event cache current even if browser history left
      // this dialog while saving. Only local UI callbacks depend on its lifetime.
      reconcileEvent(saved);
      onPersisted(saved);
      if (mounted.current) onSaved(saved);
    } catch (err) {
      if (mounted.current) {
        setError(
          `${err instanceof Error ? err.message : 'Could not update spectator placement'}. Your selection is preserved. Retry, or sign in again as an admin.`,
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const busy = saving || creatingSeason;
  return (
    <Modal
      onClose={onClose}
      closeDisabled={busy}
      style={{ maxWidth: '600px', overflowWrap: 'anywhere' }}
    >
      <h3>{title}</h3>
      <p>
        <strong>{event.name}</strong>
      </p>
      {event.status === 'archived' ? (
        <p>
          This event will remain hidden from spectators. Changing its placement
          does not restore public access. Nonhidden events remain publicly
          viewable when moved between the current list and Spectator Archive.
        </p>
      ) : (
        <p>
          {returning
            ? 'This event will return to the current spectator list and remain publicly viewable.'
            : 'This event will leave the current spectator list and remain publicly viewable in its season’s Spectator Archive. Existing spectator links continue working.'}
        </p>
      )}
      <p>
        This changes only spectator placement{!returning && ' and season'}. It
        does not change lifecycle status, release final results, delete data, or
        lock admin edits.
      </p>
      {returning ? (
        <p>
          The assigned season is retained. You can change it later using Edit.
        </p>
      ) : (
        <SeasonPicker
          id="archive-season"
          value={seasonId}
          onChange={setSeasonId}
          catalog={catalog}
          required
          disabled={saving}
          onBusyChange={setCreatingSeason}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {saving && <p role="status">Saving spectator placement…</p>}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          justifyContent: 'flex-end',
          marginTop: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (!returning && seasonId === null)}
          onClick={() => void submit()}
        >
          {title}
        </button>
      </div>
    </Modal>
  );
}
