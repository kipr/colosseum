import React, { useState, useEffect, useCallback } from 'react';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import '../Modal.css';

interface AwardTemplate {
  id: number;
  name: string;
  description: string | null;
}

interface Recipient {
  id: number;
  event_award_id: number;
  team_id: number;
  team_number: number;
  team_name: string;
}

interface EventAward {
  id: number;
  event_id: number;
  template_award_id: number | null;
  name: string;
  description: string | null;
  sort_order: number;
  recipients: Recipient[];
}

interface Team {
  id: number;
  team_number: number;
  team_name: string;
}

export default function AwardsTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;

  const [templates, setTemplates] = useState<AwardTemplate[]>([]);
  const [eventAwards, setEventAwards] = useState<EventAward[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);

  // Template modal
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AwardTemplate | null>(
    null,
  );
  const [templateForm, setTemplateForm] = useState({
    name: '',
    description: '',
  });
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Event award modal
  const [showAwardModal, setShowAwardModal] = useState(false);
  const [editingAward, setEditingAward] = useState<EventAward | null>(null);
  const [awardForm, setAwardForm] = useState({
    name: '',
    description: '',
    template_award_id: '',
    mode: 'manual' as 'manual' | 'template',
  });
  const [savingAward, setSavingAward] = useState(false);
  const [applyingAutomatic, setApplyingAutomatic] = useState(false);

  // Recipient controls
  const [addingRecipientForAwardId, setAddingRecipientForAwardId] = useState<
    number | null
  >(null);
  const [recipientTeamId, setRecipientTeamId] = useState('');

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/awards/templates', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch templates');
      setTemplates(await res.json());
    } catch (err) {
      console.error(err);
      toast.error('Failed to load award templates');
    }
  }, []);

  const fetchEventAwards = useCallback(async () => {
    if (!selectedEventId) {
      setEventAwards([]);
      return;
    }
    try {
      const res = await fetch(`/awards/event/${selectedEventId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch event awards');
      setEventAwards(await res.json());
    } catch (err) {
      console.error(err);
      toast.error('Failed to load event awards');
    }
  }, [selectedEventId]);

  const fetchTeams = useCallback(async () => {
    if (!selectedEventId) {
      setTeams([]);
      return;
    }
    try {
      const res = await fetch(`/teams/event/${selectedEventId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch teams');
      setTeams(await res.json());
    } catch (err) {
      console.error(err);
      toast.error('Failed to load teams');
    }
  }, [selectedEventId]);

  const loadAll = useCallback(() => {
    setLoading(true);
    Promise.all([fetchTemplates(), fetchEventAwards(), fetchTeams()]).finally(
      () => setLoading(false),
    );
  }, [fetchTemplates, fetchEventAwards, fetchTeams]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Template CRUD ──

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ name: '', description: '' });
    setShowTemplateModal(true);
  };

  const handleEditTemplate = (t: AwardTemplate) => {
    setEditingTemplate(t);
    setTemplateForm({ name: t.name, description: t.description ?? '' });
    setShowTemplateModal(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSavingTemplate(true);
    try {
      const body = {
        name: templateForm.name.trim(),
        description: templateForm.description.trim() || null,
      };
      if (editingTemplate) {
        const res = await fetch(`/awards/templates/${editingTemplate.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        toast.success('Template updated');
      } else {
        const res = await fetch('/awards/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        toast.success('Template created');
      }
      setShowTemplateModal(false);
      await fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (t: AwardTemplate) => {
    const ok = await confirm({
      title: 'Delete Template',
      message: `Delete award template "${t.name}"? This will not affect existing event awards.`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/awards/templates/${t.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Template deleted');
      await fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  // ── Event Award CRUD ──

  const handleCreateAward = () => {
    setEditingAward(null);
    setAwardForm({
      name: '',
      description: '',
      template_award_id: '',
      mode: 'manual',
    });
    setShowAwardModal(true);
  };

  const handleEditAward = (a: EventAward) => {
    setEditingAward(a);
    setAwardForm({
      name: a.name,
      description: a.description ?? '',
      template_award_id: '',
      mode: 'manual',
    });
    setShowAwardModal(true);
  };

  const handleSaveAward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (awardForm.mode === 'manual' && !awardForm.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (awardForm.mode === 'template' && !awardForm.template_award_id) {
      toast.error('Select a template');
      return;
    }

    setSavingAward(true);
    try {
      if (editingAward) {
        const body = {
          name: awardForm.name.trim(),
          description: awardForm.description.trim() || null,
        };
        const res = await fetch(`/awards/event-awards/${editingAward.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        toast.success('Award updated');
      } else {
        const body: Record<string, unknown> = {};
        if (awardForm.mode === 'template') {
          body.template_award_id = Number(awardForm.template_award_id);
        } else {
          body.name = awardForm.name.trim();
          body.description = awardForm.description.trim() || null;
        }
        const res = await fetch(`/awards/event/${selectedEventId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        toast.success('Award added');
      }
      setShowAwardModal(false);
      await fetchEventAwards();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingAward(false);
    }
  };

  const handleApplyAutomaticAwards = async () => {
    if (!selectedEventId) return;
    setApplyingAutomatic(true);
    try {
      const res = await fetch(`/awards/event/${selectedEventId}/automatic`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as {
        created?: number;
        removed?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to apply automatic awards');
      }
      const created = data.created ?? 0;
      const removed = data.removed ?? 0;
      if (created === 0) {
        toast.success(
          removed > 0
            ? `Cleared ${removed} previous automatic award(s). No placements could be computed from current data.`
            : 'No automatic placements could be computed from current data.',
        );
      } else {
        toast.success(
          removed > 0
            ? `Added ${created} automatic award(s). Replaced ${removed} previous automatic award(s).`
            : `Added ${created} automatic award(s).`,
        );
      }
      await fetchEventAwards();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to apply automatic awards',
      );
    } finally {
      setApplyingAutomatic(false);
    }
  };

  const handleDeleteAward = async (a: EventAward) => {
    const ok = await confirm({
      title: 'Delete Award',
      message: `Delete award "${a.name}" and all its recipients?`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/awards/event-awards/${a.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Award deleted');
      await fetchEventAwards();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleMoveAward = async (award: EventAward, direction: -1 | 1) => {
    const idx = eventAwards.findIndex((a) => a.id === award.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= eventAwards.length) return;

    const other = eventAwards[swapIdx];
    try {
      await Promise.all([
        fetch(`/awards/event-awards/${award.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sort_order: other.sort_order }),
        }),
        fetch(`/awards/event-awards/${other.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sort_order: award.sort_order }),
        }),
      ]);
      await fetchEventAwards();
    } catch {
      toast.error('Failed to reorder');
    }
  };

  // ── Recipients ──

  const handleAddRecipient = async (awardId: number) => {
    if (!recipientTeamId) return;
    try {
      const res = await fetch(`/awards/event-awards/${awardId}/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ team_id: Number(recipientTeamId) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success('Recipient added');
      setRecipientTeamId('');
      setAddingRecipientForAwardId(null);
      await fetchEventAwards();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleRemoveRecipient = async (awardId: number, teamId: number) => {
    try {
      const res = await fetch(
        `/awards/event-awards/${awardId}/recipients/${teamId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to remove');
      toast.success('Recipient removed');
      await fetchEventAwards();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  // ── Render ──

  return (
    <div className="awards-tab">
      {loading && <p style={{ color: 'var(--secondary-color)' }}>Loading...</p>}

      {/* Section A: Global templates */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3>Award Templates</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
          Reusable award definitions. Changes here do not affect awards already
          added to events.
        </p>
        <button className="btn btn-primary" onClick={handleCreateTemplate}>
          + New Template
        </button>
        {templates.length > 0 && (
          <table style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td style={{ color: 'var(--secondary-color)' }}>
                    {t.description || '—'}
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleEditTemplate(t)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ marginLeft: '0.5rem' }}
                      onClick={() => handleDeleteTemplate(t)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Section B: Event awards */}
      {!selectedEventId ? (
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to manage awards.
          </p>
        </div>
      ) : (
        <div className="card">
          <h3>Event Awards</h3>
          <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
            Awards for this event. Published alongside final scores.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              alignItems: 'center',
              marginBottom: '0.5rem',
            }}
          >
            <button className="btn btn-primary" onClick={handleCreateAward}>
              + Add Award
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={applyingAutomatic}
              onClick={handleApplyAutomaticAwards}
            >
              {applyingAutomatic
                ? 'Applying…'
                : 'Add automatic awards (from results)'}
            </button>
          </div>
          <p
            style={{
              color: 'var(--secondary-color)',
              fontSize: '0.9rem',
              marginBottom: '1rem',
            }}
          >
            Automatic awards use the same rules as the spectator view (DE
            placement, per-bracket overall, event overall). They are stored as
            event awards whose names start with &quot;Auto:&quot;; clicking the
            button replaces previous automatic awards with a fresh calculation.
          </p>

          {eventAwards.length === 0 ? (
            <p
              style={{
                color: 'var(--secondary-color)',
                marginTop: '1rem',
              }}
            >
              No awards yet.
            </p>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              {eventAwards.map((award, idx) => (
                <div
                  key={award.id}
                  className="card"
                  style={{
                    marginBottom: '1rem',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <div>
                      <strong>{award.name}</strong>
                      {award.description && (
                        <p
                          style={{
                            color: 'var(--secondary-color)',
                            margin: '0.25rem 0 0',
                          }}
                        >
                          {award.description}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        className="btn btn-secondary"
                        disabled={idx === 0}
                        onClick={() => handleMoveAward(award, -1)}
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={idx === eventAwards.length - 1}
                        onClick={() => handleMoveAward(award, 1)}
                        title="Move down"
                      >
                        ▼
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleEditAward(award)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteAward(award)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Recipients */}
                  <div style={{ marginTop: '0.75rem' }}>
                    <strong style={{ fontSize: '0.9rem' }}>Recipients:</strong>
                    {award.recipients.length === 0 ? (
                      <span
                        style={{
                          color: 'var(--secondary-color)',
                          marginLeft: '0.5rem',
                        }}
                      >
                        None
                      </span>
                    ) : (
                      <ul
                        style={{
                          margin: '0.25rem 0 0',
                          paddingLeft: '1.25rem',
                        }}
                      >
                        {award.recipients.map((r) => (
                          <li key={r.team_id}>
                            #{r.team_number} {r.team_name}
                            <button
                              className="btn btn-danger"
                              style={{
                                marginLeft: '0.5rem',
                                padding: '0.1rem 0.4rem',
                                fontSize: '0.75rem',
                              }}
                              onClick={() =>
                                handleRemoveRecipient(award.id, r.team_id)
                              }
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {addingRecipientForAwardId === award.id ? (
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.5rem',
                          marginTop: '0.5rem',
                          alignItems: 'center',
                        }}
                      >
                        <select
                          className="field-input"
                          value={recipientTeamId}
                          onChange={(e) => setRecipientTeamId(e.target.value)}
                          style={{ maxWidth: '250px' }}
                        >
                          <option value="">— Select team —</option>
                          {teams
                            .filter(
                              (t) =>
                                !award.recipients.some(
                                  (r) => r.team_id === t.id,
                                ),
                            )
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                #{t.team_number} {t.team_name}
                              </option>
                            ))}
                        </select>
                        <button
                          className="btn btn-primary"
                          disabled={!recipientTeamId}
                          onClick={() => handleAddRecipient(award.id)}
                        >
                          Add
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            setAddingRecipientForAwardId(null);
                            setRecipientTeamId('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-secondary"
                        style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
                        onClick={() => {
                          setAddingRecipientForAwardId(award.id);
                          setRecipientTeamId('');
                        }}
                      >
                        + Add Recipient
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Template modal */}
      {showTemplateModal && (
        <div className="modal show" onClick={() => setShowTemplateModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={() => setShowTemplateModal(false)}>
              &times;
            </span>
            <h3>{editingTemplate ? 'Edit Template' : 'New Award Template'}</h3>
            <form onSubmit={handleSaveTemplate}>
              <div className="form-group">
                <label htmlFor="tmpl-name">Name *</label>
                <input
                  id="tmpl-name"
                  type="text"
                  className="field-input"
                  value={templateForm.name}
                  onChange={(e) =>
                    setTemplateForm({ ...templateForm, name: e.target.value })
                  }
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="tmpl-desc">Description</label>
                <textarea
                  id="tmpl-desc"
                  className="field-input"
                  rows={3}
                  value={templateForm.description}
                  onChange={(e) =>
                    setTemplateForm({
                      ...templateForm,
                      description: e.target.value,
                    })
                  }
                />
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
                  onClick={() => setShowTemplateModal(false)}
                  disabled={savingTemplate}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingTemplate}
                >
                  {savingTemplate ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Event award modal */}
      {showAwardModal && (
        <div className="modal show" onClick={() => setShowAwardModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={() => setShowAwardModal(false)}>
              &times;
            </span>
            <h3>{editingAward ? 'Edit Award' : 'Add Event Award'}</h3>
            <form onSubmit={handleSaveAward}>
              {!editingAward && (
                <div className="form-group">
                  <label>Add as</label>
                  <div
                    style={{
                      display: 'flex',
                      gap: '1rem',
                      marginTop: '0.25rem',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <input
                        type="radio"
                        name="award-mode"
                        checked={awardForm.mode === 'manual'}
                        onChange={() =>
                          setAwardForm({ ...awardForm, mode: 'manual' })
                        }
                      />
                      Manual
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <input
                        type="radio"
                        name="award-mode"
                        checked={awardForm.mode === 'template'}
                        onChange={() =>
                          setAwardForm({ ...awardForm, mode: 'template' })
                        }
                        disabled={templates.length === 0}
                      />
                      From template
                    </label>
                  </div>
                </div>
              )}

              {!editingAward && awardForm.mode === 'template' && (
                <div className="form-group">
                  <label htmlFor="award-tmpl">Template *</label>
                  <select
                    id="award-tmpl"
                    className="field-input"
                    value={awardForm.template_award_id}
                    onChange={(e) =>
                      setAwardForm({
                        ...awardForm,
                        template_award_id: e.target.value,
                      })
                    }
                    required
                  >
                    <option value="">— Select —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(editingAward || awardForm.mode === 'manual') && (
                <>
                  <div className="form-group">
                    <label htmlFor="award-name">Name *</label>
                    <input
                      id="award-name"
                      type="text"
                      className="field-input"
                      value={awardForm.name}
                      onChange={(e) =>
                        setAwardForm({ ...awardForm, name: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="award-desc">Description</label>
                    <textarea
                      id="award-desc"
                      className="field-input"
                      rows={3}
                      value={awardForm.description}
                      onChange={(e) =>
                        setAwardForm({
                          ...awardForm,
                          description: e.target.value,
                        })
                      }
                    />
                  </div>
                </>
              )}

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
                  onClick={() => setShowAwardModal(false)}
                  disabled={savingAward}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingAward}
                >
                  {savingAward ? 'Saving...' : 'Save'}
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
