import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import {
  adminEventPath,
  adminEventsPath,
  isAdminView,
} from '../../utils/routes';
import { formatDate, toDateOnlyString } from '../../utils/dateUtils';
import {
  Event,
  EventStatus,
  ScoreAcceptMode,
  SpectatorListing,
  getSpectatorListingLabel,
  getEventStatusClass,
  getEventStatusLabel,
  formatEventDate,
  isEventActive,
} from '../../utils/eventStatus';
import { apiFetch } from '../../utils/api';
import Modal from '../Modal';
import SeasonPicker from './SeasonPicker';
import SpectatorPlacementDialog from './SpectatorPlacementDialog';
import { useSeasons } from '../../hooks/useSeasons';

interface EventFormData {
  name: string;
  description: string;
  event_date: string;
  location: string;
  seeding_rounds: number;
  min_rest_minutes: number;
  score_accept_mode: ScoreAcceptMode;
  season_id: number | null;
}

const defaultFormData: EventFormData = {
  name: '',
  description: '',
  event_date: '',
  location: '',
  seeding_rounds: 3,
  min_rest_minutes: 3,
  score_accept_mode: 'manual',
  season_id: null,
};

// A created event awaiting selection. Only the save and its own post-save
// refresh may select it; the wait ends once that refresh settles.
interface PendingCreatedSelection {
  id: number;
  refreshSettled: boolean;
  fromSelectedId: number | null;
}

const adminStatusLabel = (status: EventStatus) =>
  status === 'archived'
    ? 'Hidden from Spectators'
    : getEventStatusLabel(status);

export default function EventsTab() {
  const {
    events,
    refreshEvents,
    beginEventMutation,
    selectedEvent,
    setSelectedEvent,
  } = useEvent();
  const catalog = useSeasons();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [pendingCreated, setPendingCreated] =
    useState<PendingCreatedSelection | null>(null);
  const [formData, setFormData] = useState<EventFormData>(defaultFormData);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<EventStatus | 'all'>('all');
  const [filterPlacement, setFilterPlacement] = useState<
    SpectatorListing | 'all'
  >('all');
  const [placementEvent, setPlacementEvent] = useState<Event | null>(null);
  const [creatingSeason, setCreatingSeason] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const formPending = useRef(false);
  const formSession = useRef(0);
  const mounted = useRef(false);
  const placementTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (placementEvent || !placementTrigger.current) return;
    const trigger = placementTrigger.current;
    placementTrigger.current = null;
    if (!trigger.isConnected && !document.querySelector('dialog[open]')) {
      document.getElementById('placement-filter')?.focus();
    }
  }, [placementEvent]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [togglingRelease, setTogglingRelease] = useState(false);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const rawView = searchParams.get('view');
  const currentAdminView = isAdminView(rawView) ? rawView : 'events';

  const handleSelectEvent = useCallback(
    (event: Event | null) => {
      setPendingCreated(null);
      setSelectedEvent(event);
      if (event) {
        navigate(adminEventPath(event.id, currentAdminView));
      } else {
        navigate(adminEventsPath(currentAdminView));
      }
    },
    [currentAdminView, navigate, setSelectedEvent],
  );

  const selectedEventId = selectedEvent?.id ?? null;

  useEffect(() => {
    if (!pendingCreated) return;
    // The admin picked another event meanwhile (e.g. the Navbar); keep it.
    if (selectedEventId !== pendingCreated.fromSelectedId) {
      setPendingCreated(null);
      return;
    }
    // Reconciliation may defer to a refresh. Selecting an event before it is
    // cached would make the provider and route guards treat it as deleted.
    // The wait is bounded by the post-save refresh: once it settles without
    // the event, a later unrelated refresh must not navigate to it.
    const created = events.find((event) => event.id === pendingCreated.id);
    if (created) handleSelectEvent(created);
    else if (pendingCreated.refreshSettled) setPendingCreated(null);
  }, [pendingCreated, events, selectedEventId, handleSelectEvent]);

  const filteredEvents = events.filter(
    (event) =>
      (filterStatus === 'all' || event.status === filterStatus) &&
      (filterPlacement === 'all' ||
        event.spectator_listing === filterPlacement),
  );

  const seasonLabel = (event: Event) =>
    event.season_id === null
      ? 'No season'
      : (catalog.seasons.find((season) => season.id === event.season_id)
          ?.name ?? `Season #${event.season_id}`);

  const placementAction = (event: Event) => (
    <button
      className="btn btn-secondary"
      onClick={(click) => {
        placementTrigger.current = click.currentTarget;
        setPlacementEvent(event);
      }}
    >
      {event.spectator_listing === 'archive'
        ? 'Return to Current Events'
        : 'Move to Spectator Archive'}
    </button>
  );

  const handleCreateNew = () => {
    setPendingCreated(null);
    ++formSession.current;
    setFormError(null);
    setEditingEvent(null);
    setFormData(defaultFormData);
    setShowModal(true);
  };

  const handleEdit = (event: Event) => {
    setPendingCreated(null);
    ++formSession.current;
    setFormError(null);
    setEditingEvent(event);
    setFormData({
      name: event.name,
      description: event.description || '',
      event_date: toDateOnlyString(event.event_date) || '',
      location: event.location || '',
      seeding_rounds: event.seeding_rounds,
      min_rest_minutes: event.min_rest_minutes,
      score_accept_mode: event.score_accept_mode ?? 'manual',
      season_id: event.season_id,
    });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    if (formPending.current || creatingSeason) return;
    ++formSession.current;
    setSaving(false);
    setFormError(null);
    setShowModal(false);
    setEditingEvent(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formPending.current || creatingSeason) return;
    if (!formData.name.trim()) {
      setFormError('Event name is required');
      return;
    }
    if (
      editingEvent?.spectator_listing === 'archive' &&
      formData.season_id === null
    ) {
      setFormError(
        'A season is required for an event in the Spectator Archive.',
      );
      return;
    }

    const session = formSession.current;
    const submittedSelectionId = selectedEventId;
    formPending.current = true;
    setFormError(null);
    setSaving(true);
    try {
      const url = editingEvent ? `/events/${editingEvent.id}` : '/events';
      const method = editingEvent ? 'PATCH' : 'POST';

      const reconcileEvent = beginEventMutation();
      const savedEvent = await apiFetch<Event>(url, {
        method,
        body: {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          event_date: formData.event_date || null,
          location: formData.location.trim() || null,
          seeding_rounds: formData.seeding_rounds,
          min_rest_minutes: formData.min_rest_minutes,
          score_accept_mode: formData.score_accept_mode,
          ...(!editingEvent || formData.season_id !== editingEvent.season_id
            ? { season_id: formData.season_id }
            : {}),
        },
        fallbackError: 'Failed to save event',
      });
      reconcileEvent(savedEvent);
      const refreshed = refreshEvents({ background: true });
      if (!mounted.current || session !== formSession.current) return;
      toast.success(editingEvent ? 'Event updated!' : 'Event created!');
      formPending.current = false;
      handleCloseModal();
      if (!editingEvent && savedEvent.id) {
        const id = savedEvent.id;
        setPendingCreated({
          id,
          refreshSettled: false,
          fromSelectedId: submittedSelectionId,
        });
        // Mark settled rather than clearing: an accepted refresh commits its
        // events in the same render, so the effect can still select first.
        const settle = () => {
          if (!mounted.current) return;
          setPendingCreated((current) =>
            current?.id === id ? { ...current, refreshSettled: true } : current,
          );
        };
        void refreshed.then(settle, settle);
      }
    } catch (error) {
      if (mounted.current && session === formSession.current) {
        setFormError(
          `${error instanceof Error ? error.message : 'Failed to save event'}. Your changes are preserved. Retry, or sign in again as an admin.`,
        );
      }
    } finally {
      formPending.current = false;
      if (mounted.current && session === formSession.current) setSaving(false);
    }
  };

  const handleStatusChange = async (event: Event, newStatus: EventStatus) => {
    if (newStatus === 'archived') {
      const confirmed = await confirm({
        title: 'Hide from Spectators',
        message: `Hide "${event.name}" from spectators? This sets its lifecycle status to hidden (archived), removes it from both spectator listings, and blocks public event details and final results. As with other status changes away from Complete, this clears the final-results release flag. This is not the publicly viewable Spectator Archive. No data is deleted.`,
        confirmText: 'Hide from Spectators',
        confirmStyle: 'warning',
      });
      if (!confirmed) return;
    }

    try {
      await apiFetch(`/events/${event.id}`, {
        method: 'PATCH',
        body: { status: newStatus },
        fallbackError: 'Failed to update event status',
      });

      toast.success(
        newStatus === 'archived'
          ? 'Event hidden from spectators!'
          : `Event ${getEventStatusLabel(newStatus).toLowerCase()}!`,
      );
      await refreshEvents();
    } catch (error) {
      console.error('Error updating event status:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update status',
      );
    }
  };

  const handleToggleResultsRelease = async (event: Event) => {
    const releasing = !event.spectator_results_released;
    setTogglingRelease(true);
    try {
      await apiFetch(`/events/${event.id}`, {
        method: 'PATCH',
        body: {
          spectator_results_released: releasing ? 1 : 0,
        },
        fallbackError: 'Failed to update release state',
      });
      toast.success(
        releasing
          ? 'Final scores released to spectators!'
          : 'Final scores hidden from spectators.',
      );
      await refreshEvents();
    } catch (error) {
      console.error('Error toggling results release:', error);
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to toggle results release',
      );
    } finally {
      setTogglingRelease(false);
    }
  };

  const getFallbackSelectionAfterDelete = (deletedEventId: number) => {
    const remainingEvents = events.filter(
      (event) => event.id !== deletedEventId,
    );
    if (remainingEvents.length === 0) return null;

    const preferredEvent =
      remainingEvents.find((event) => isEventActive(event.status)) ||
      remainingEvents[0];
    return preferredEvent.id;
  };

  const handleDelete = async (event: Event) => {
    const isDeletingSelected = event.id === selectedEvent?.id;
    const confirmed = await confirm({
      title: 'Delete Event',
      message: isDeletingSelected
        ? `Delete "${event.name}"? This event is currently selected and your selection will move to another event (or clear if none remain).`
        : `Delete "${event.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    try {
      await apiFetch(`/events/${event.id}`, {
        method: 'DELETE',
        fallbackError: 'Failed to delete event',
      });

      const fallbackEventId = isDeletingSelected
        ? getFallbackSelectionAfterDelete(event.id)
        : (selectedEvent?.id ?? null);
      const fallbackEvent =
        fallbackEventId == null
          ? null
          : (events.find(
              (remainingEvent) => remainingEvent.id === fallbackEventId,
            ) ?? null);

      await refreshEvents();
      handleSelectEvent(fallbackEvent);
      toast.success('Event deleted!');
    } catch (error) {
      console.error('Error deleting event:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete event',
      );
    }
  };

  const getStatusActions = (event: Event) => {
    const actions: {
      label: string;
      status: EventStatus;
      className: string;
    }[] = [];

    switch (event.status) {
      case 'setup':
        actions.push({
          label: 'Start',
          status: 'active',
          className: 'btn-success',
        });
        actions.push({
          label: 'Hide from Spectators',
          status: 'archived',
          className: 'btn-warning',
        });
        break;
      case 'active':
        actions.push({
          label: 'Mark Complete',
          status: 'complete',
          className: 'btn-primary',
        });
        actions.push({
          label: 'Back to Setup',
          status: 'setup',
          className: 'btn-secondary',
        });
        break;
      case 'complete':
        actions.push({
          label: 'Hide from Spectators',
          status: 'archived',
          className: 'btn-warning',
        });
        actions.push({
          label: 'Reopen',
          status: 'active',
          className: 'btn-secondary',
        });
        break;
      case 'archived':
        actions.push({
          label: 'Restore',
          status: 'setup',
          className: 'btn-secondary',
        });
        break;
    }

    return actions;
  };

  // Filter out the selected event from the table list
  const otherEvents = filteredEvents.filter((e) => e.id !== selectedEvent?.id);

  const otherEventsColumns: UnifiedColumnDef<Event>[] = [
    {
      kind: 'data',
      id: 'name',
      header: { full: 'Name' },
      renderCell: (event) => (
        <>
          <strong>{event.name}</strong>
          {event.description && (
            <div
              style={{
                fontSize: '0.85rem',
                color: 'var(--secondary-color)',
                marginTop: '0.25rem',
              }}
            >
              {event.description}
            </div>
          )}
        </>
      ),
    },
    {
      kind: 'data',
      id: 'date',
      header: { full: 'Date' },
      renderCell: (event) =>
        event.event_date ? (
          formatEventDate(event.event_date)
        ) : (
          <em style={{ color: 'var(--secondary-color)' }}>Not set</em>
        ),
    },
    {
      kind: 'data',
      id: 'location',
      header: { full: 'Location' },
      renderCell: (event) =>
        event.location || (
          <em style={{ color: 'var(--secondary-color)' }}>Not set</em>
        ),
    },
    {
      kind: 'data',
      id: 'status',
      header: { full: 'Status' },
      renderCell: (event) => (
        <span
          className={`event-status-badge ${getEventStatusClass(event.status)}`}
        >
          {adminStatusLabel(event.status)}
        </span>
      ),
    },
    {
      kind: 'data',
      id: 'season',
      header: { full: 'Season' },
      renderCell: seasonLabel,
    },
    {
      kind: 'data',
      id: 'spectator_listing',
      header: { full: 'Spectator Placement' },
      renderCell: (event) => getSpectatorListingLabel(event.spectator_listing),
    },
    {
      kind: 'data',
      id: 'seeding',
      header: { full: 'Seeding Rounds' },
      renderCell: (event) => event.seeding_rounds,
    },
    {
      kind: 'data',
      id: 'double_seeding',
      header: { full: 'Double Seeding' },
      renderCell: (event) =>
        event.double_seeding_rounds > 0
          ? `${event.double_seeding_rounds} round${event.double_seeding_rounds === 1 ? '' : 's'}`
          : 'Disabled',
    },
    {
      kind: 'data',
      id: 'created',
      header: { full: 'Created' },
      renderCell: (event) => formatDate(event.created_at),
    },
    {
      kind: 'data',
      id: 'actions',
      header: { full: 'Actions' },
      renderCell: (event) => (
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <button
            className="btn btn-primary"
            onClick={() => handleSelectEvent(event)}
            title="Select this event to work on"
          >
            Select
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleEdit(event)}
            title="Edit event details"
          >
            Edit
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handleDelete(event)}
            title="Delete this event"
          >
            Delete
          </button>
          {placementAction(event)}
          {getStatusActions(event).map((action) => (
            <button
              key={action.status}
              className={`btn ${action.className}`}
              onClick={() => handleStatusChange(event, action.status)}
              title={`Change status to ${action.status}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Current Event - Prominent display */}
      {selectedEvent ? (
        <div
          className="card"
          style={{
            marginBottom: '1.5rem',
            border: '2px solid var(--primary-color)',
            background:
              'linear-gradient(135deg, var(--card-bg) 0%, var(--bg-color) 100%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.25rem',
                }}
              >
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--primary-color)',
                  }}
                >
                  Currently Selected
                </span>
              </div>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.5rem' }}>
                <strong>{selectedEvent.name}</strong>
              </h3>
              {selectedEvent.description && (
                <p
                  style={{
                    color: 'var(--secondary-color)',
                    margin: '0 0 0.75rem 0',
                  }}
                >
                  {selectedEvent.description}
                </p>
              )}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  fontSize: '0.9rem',
                  color: 'var(--secondary-color)',
                }}
              >
                <span>
                  <strong>Date:</strong>{' '}
                  {selectedEvent.event_date
                    ? formatEventDate(selectedEvent.event_date)
                    : 'Not set'}
                </span>
                <span>
                  <strong>Location:</strong>{' '}
                  {selectedEvent.location || 'Not set'}
                </span>
                <span>
                  <strong>Season:</strong> {seasonLabel(selectedEvent)}
                </span>
                <span>
                  <strong>Spectator Placement:</strong>{' '}
                  {getSpectatorListingLabel(selectedEvent.spectator_listing)}
                  {selectedEvent.status === 'archived' &&
                    ' (hidden from spectators)'}
                </span>
                <span>
                  <strong>Seeding Rounds:</strong>{' '}
                  {selectedEvent.seeding_rounds}
                </span>
                <span>
                  <strong>Double Seeding:</strong>{' '}
                  {selectedEvent.double_seeding_rounds > 0
                    ? `${selectedEvent.double_seeding_rounds} round${selectedEvent.double_seeding_rounds === 1 ? '' : 's'}`
                    : 'Disabled'}
                </span>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '0.75rem',
              }}
            >
              <span
                className={`event-status-badge ${getEventStatusClass(selectedEvent.status)}`}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
              >
                {adminStatusLabel(selectedEvent.status)}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleEdit(selectedEvent)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(selectedEvent)}
                >
                  Delete
                </button>
                {placementAction(selectedEvent)}
                {getStatusActions(selectedEvent).map((action) => (
                  <button
                    key={action.status}
                    className={`btn ${action.className}`}
                    onClick={() =>
                      handleStatusChange(selectedEvent, action.status)
                    }
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              {selectedEvent.status === 'complete' && (
                <button
                  className={`btn ${selectedEvent.spectator_results_released ? 'btn-warning' : 'btn-success'}`}
                  onClick={() => handleToggleResultsRelease(selectedEvent)}
                  disabled={togglingRelease}
                  title={
                    selectedEvent.spectator_results_released
                      ? 'Hide final score tabs from spectators'
                      : 'Release documentation, bracket rankings, and overall scores to spectators'
                  }
                >
                  {togglingRelease
                    ? 'Updating...'
                    : selectedEvent.spectator_results_released
                      ? 'Hide Final Scores'
                      : 'Release Final Scores'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="card"
          style={{
            marginBottom: '1.5rem',
            border: '2px dashed var(--border-color)',
            textAlign: 'center',
            padding: '2rem',
          }}
        >
          <p style={{ color: 'var(--secondary-color)', margin: 0 }}>
            No event selected. Select an event from the list below or create a
            new one.
          </p>
        </div>
      )}

      {/* Header with create button and filter */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h4 style={{ margin: '0 0 0.25rem 0' }}>All Events</h4>
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: 'var(--secondary-color)',
            }}
          >
            Select a different event to work on, or create a new one.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label
              htmlFor="status-filter"
              style={{ color: 'var(--secondary-color)', fontSize: '0.9rem' }}
            >
              Lifecycle status
            </label>
            <select
              id="status-filter"
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(e.target.value as EventStatus | 'all')
              }
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid var(--border-color)',
                background: 'var(--card-bg)',
                color: 'var(--text-color)',
              }}
            >
              <option value="all">All Events</option>
              <option value="setup">Setup</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
              <option value="archived">Hidden from Spectators</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor="placement-filter">Spectator placement</label>
            <select
              id="placement-filter"
              className="field-input"
              value={filterPlacement}
              onChange={(event) =>
                setFilterPlacement(
                  event.target.value as SpectatorListing | 'all',
                )
              }
            >
              <option value="all">All Placements</option>
              <option value="current">Current Events</option>
              <option value="archive">Spectator Archive</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleCreateNew}>
            + Create New Event
          </button>
        </div>
      </div>

      {/* Events list (excluding currently selected) */}
      <div className="card">
        {otherEvents.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            {events.length === 0
              ? 'No events created yet. Create your first event to get started!'
              : 'No other events match these filters. The selected event is shown above.'}
          </p>
        ) : (
          <UnifiedTable
            columns={otherEventsColumns}
            rows={otherEvents}
            getRowKey={(e) => e.id}
            headerLabelVariant="none"
          />
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal
          onClose={handleCloseModal}
          closeDisabled={saving || creatingSeason}
          style={{ maxWidth: '600px', overflowWrap: 'anywhere' }}
        >
          <h3>{editingEvent ? 'Edit Event' : 'Create New Event'}</h3>
          <p
            style={{
              color: 'var(--secondary-color)',
              marginBottom: '1.5rem',
            }}
          >
            {editingEvent
              ? 'Update the event details below.'
              : 'Fill in the details for your new event.'}
          </p>

          <form onSubmit={handleSubmit}>
            {formError && <p role="alert">{formError}</p>}
            {saving && <p role="status">Saving event…</p>}
            <div className="form-group">
              <label htmlFor="event-name">Event Name *</label>
              <input
                id="event-name"
                type="text"
                className="field-input"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g., 2026 Botball Regional"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="event-description">Description</label>
              <textarea
                id="event-description"
                className="field-input"
                rows={2}
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Optional description of the event"
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
              }}
            >
              <div className="form-group">
                <label htmlFor="event-date">Event Date</label>
                <input
                  id="event-date"
                  type="date"
                  className="field-input"
                  value={formData.event_date}
                  onChange={(e) =>
                    setFormData({ ...formData, event_date: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label htmlFor="event-location">Location</label>
                <input
                  id="event-location"
                  type="text"
                  className="field-input"
                  value={formData.location}
                  onChange={(e) =>
                    setFormData({ ...formData, location: e.target.value })
                  }
                  placeholder="e.g., San Jose, CA"
                />
              </div>
            </div>

            <SeasonPicker
              key={formSession.current}
              id="event-season"
              value={formData.season_id}
              onChange={(season_id) =>
                setFormData((current) => ({ ...current, season_id }))
              }
              catalog={catalog}
              required={editingEvent?.spectator_listing === 'archive'}
              disabled={saving}
              onBusyChange={setCreatingSeason}
            />

            <div className="form-group">
              <label htmlFor="seeding-rounds">Seeding Rounds</label>
              <input
                id="seeding-rounds"
                type="number"
                className="field-input"
                value={formData.seeding_rounds}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    seeding_rounds: parseInt(e.target.value, 10) || 3,
                  })
                }
                min={1}
                max={10}
                style={{ maxWidth: '100px' }}
              />
              <small style={{ color: 'var(--secondary-color)' }}>
                Number of seeding rounds for this event (typically 3)
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="min-rest-minutes">Minimum Rest (minutes)</label>
              <input
                id="min-rest-minutes"
                type="number"
                className="field-input"
                value={formData.min_rest_minutes}
                onChange={(e) => {
                  const value = Number.parseInt(e.target.value, 10);
                  setFormData({
                    ...formData,
                    min_rest_minutes: Number.isNaN(value)
                      ? 0
                      : Math.max(0, value),
                  });
                }}
                min={0}
                step={1}
                style={{ maxWidth: '100px' }}
              />
              <small style={{ color: 'var(--secondary-color)' }}>
                Warn before calling a team that played within this window. A
                value of 0 disables recent-play warnings.
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="score-accept-mode">Score Accept Mode</label>
              <select
                id="score-accept-mode"
                className="field-input"
                value={formData.score_accept_mode}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    score_accept_mode: e.target.value as ScoreAcceptMode,
                  })
                }
              >
                <option value="manual">
                  Manual (admin reviews each score)
                </option>
                <option value="auto_accept_seeding">
                  Auto-accept seeding scores only
                </option>
                <option value="auto_accept_all">
                  Auto-accept all scores (seeding + bracket)
                </option>
              </select>
              {formData.score_accept_mode === 'auto_accept_all' && (
                <small
                  style={{
                    color: 'var(--warning-color, #f59e0b)',
                    display: 'block',
                    marginTop: '0.25rem',
                  }}
                >
                  Warning: Auto-accepting bracket scores is risky — incorrect
                  scores will immediately alter bracket progression.
                </small>
              )}
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
                disabled={saving || creatingSeason}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || creatingSeason}
              >
                {saving
                  ? 'Saving...'
                  : editingEvent
                    ? 'Update Event'
                    : 'Create Event'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {placementEvent && (
        <SpectatorPlacementDialog
          key={placementEvent.id}
          event={placementEvent}
          catalog={catalog}
          onClose={() => setPlacementEvent(null)}
          onPersisted={() => {
            void refreshEvents({ background: true });
          }}
          onSaved={(saved) => {
            setPlacementEvent(null);
            toast.success(
              saved.spectator_listing === 'archive'
                ? 'Event moved to Spectator Archive!'
                : 'Event returned to Current Events!',
            );
          }}
        />
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
