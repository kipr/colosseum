import React, { useState } from 'react';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { formatDate, toDateOnlyString } from '../../utils/dateUtils';
import {
  Event,
  EventStatus,
  ScoreAcceptMode,
  getEventStatusClass,
  getEventStatusLabel,
  formatEventDate,
  isEventActive,
} from '../../utils/eventStatus';
import '../Modal.css';

interface EventFormData {
  name: string;
  description: string;
  event_date: string;
  location: string;
  seeding_rounds: number;
  score_accept_mode: ScoreAcceptMode;
}

const defaultFormData: EventFormData = {
  name: '',
  description: '',
  event_date: '',
  location: '',
  seeding_rounds: 3,
  score_accept_mode: 'manual',
};

export default function EventsTab() {
  const { events, refreshEvents, selectedEvent, selectEventById } = useEvent();
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [formData, setFormData] = useState<EventFormData>(defaultFormData);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<EventStatus | 'all'>('all');

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  // Filter events based on selected status
  const filteredEvents =
    filterStatus === 'all'
      ? events
      : events.filter((e) => e.status === filterStatus);

  const handleCreateNew = () => {
    setEditingEvent(null);
    setFormData(defaultFormData);
    setShowModal(true);
  };

  const handleEdit = (event: Event) => {
    setEditingEvent(event);
    setFormData({
      name: event.name,
      description: event.description || '',
      event_date: toDateOnlyString(event.event_date) || '',
      location: event.location || '',
      seeding_rounds: event.seeding_rounds,
      score_accept_mode: event.score_accept_mode ?? 'manual',
    });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingEvent(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Event name is required');
      return;
    }

    setSaving(true);
    try {
      const url = editingEvent ? `/events/${editingEvent.id}` : '/events';
      const method = editingEvent ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          event_date: formData.event_date || null,
          location: formData.location.trim() || null,
          seeding_rounds: formData.seeding_rounds,
          score_accept_mode: formData.score_accept_mode,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save event');
      }

      const savedEvent = await response.json();
      toast.success(editingEvent ? 'Event updated!' : 'Event created!');
      handleCloseModal();
      await refreshEvents();

      // If this is a new event, select it
      if (!editingEvent && savedEvent.id) {
        selectEventById(savedEvent.id);
      }
    } catch (error) {
      console.error('Error saving event:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to save event',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (event: Event, newStatus: EventStatus) => {
    // For archiving, show confirmation
    if (newStatus === 'archived') {
      const confirmed = await confirm({
        title: 'Archive Event',
        message: `Are you sure you want to archive "${event.name}"?`,
        confirmText: 'Archive',
        confirmStyle: 'warning',
      });
      if (!confirmed) return;
    }

    try {
      const response = await fetch(`/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update event status');
      }

      toast.success(`Event ${getEventStatusLabel(newStatus).toLowerCase()}!`);
      await refreshEvents();
    } catch (error) {
      console.error('Error updating event status:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update status',
      );
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
      const response = await fetch(`/events/${event.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        let errorMessage = 'Failed to delete event';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // 204/empty and non-json responses are fine; keep default message.
        }
        throw new Error(errorMessage);
      }

      const fallbackEventId = isDeletingSelected
        ? getFallbackSelectionAfterDelete(event.id)
        : (selectedEvent?.id ?? null);

      await refreshEvents();
      selectEventById(fallbackEventId);
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
          label: 'Archive',
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
          label: 'Archive',
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
                {selectedEvent.name}
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
                  <strong>Seeding Rounds:</strong>{' '}
                  {selectedEvent.seeding_rounds}
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
                {getEventStatusLabel(selectedEvent.status)}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label
              htmlFor="status-filter"
              style={{ color: 'var(--secondary-color)', fontSize: '0.9rem' }}
            >
              Filter:
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
              <option value="archived">Archived</option>
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
              : filterStatus === 'all'
                ? 'No other events available.'
                : `No other ${filterStatus} events found.`}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th>Location</th>
                <th>Status</th>
                <th>Seeding Rounds</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {otherEvents.map((event) => (
                <tr key={event.id}>
                  <td>
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
                  </td>
                  <td>
                    {event.event_date ? (
                      formatEventDate(event.event_date)
                    ) : (
                      <em style={{ color: 'var(--secondary-color)' }}>
                        Not set
                      </em>
                    )}
                  </td>
                  <td>
                    {event.location || (
                      <em style={{ color: 'var(--secondary-color)' }}>
                        Not set
                      </em>
                    )}
                  </td>
                  <td>
                    <span
                      className={`event-status-badge ${getEventStatusClass(event.status)}`}
                    >
                      {getEventStatusLabel(event.status)}
                    </span>
                  </td>
                  <td>{event.seeding_rounds}</td>
                  <td>{formatDate(event.created_at)}</td>
                  <td>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        className="btn btn-primary"
                        onClick={() => selectEventById(event.id)}
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
                      {getStatusActions(event).map((action) => (
                        <button
                          key={action.status}
                          className={`btn ${action.className}`}
                          onClick={() =>
                            handleStatusChange(event, action.status)
                          }
                          title={`Change status to ${action.status}`}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal show" onClick={handleCloseModal}>
          <div
            className="modal-content"
            style={{ maxWidth: '600px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={handleCloseModal}>
              &times;
            </span>
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
                    : editingEvent
                      ? 'Update Event'
                      : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
