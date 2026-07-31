import React, { useState, useEffect, useCallback } from 'react';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import {
  DEFAULT_AUTOMATIC_AWARD_SETTINGS,
  type AutomaticAwardSettings,
  type AutomaticAwardsPreviewResponse,
  type ZeroScoreComponent,
} from '@shared/automaticAwards';
import '../Modal.css';

const ZERO_COMPONENT_LABELS: Record<ZeroScoreComponent, string> = {
  documentation: 'documentation',
  seeding: 'seeding',
  double_seeding: 'double seeding',
  weighted_de: 'weighted DE',
};

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

interface IndividualRecipient {
  id: number;
  event_award_id: number;
  name: string;
  team_id: number | null;
  team_number: number | null;
  team_name: string | null;
  display_name?: string | null;
}

interface EventAward {
  id: number;
  event_id: number;
  template_award_id: number | null;
  name: string;
  description: string | null;
  sort_order: number;
  recipients: Recipient[];
  individual_recipients: IndividualRecipient[];
}

interface Team {
  id: number;
  team_number: number;
  team_name: string;
}

/** Matches server AUTO_AWARD_NAME_PREFIX in automaticAwards.ts */
const AUTO_AWARD_NAME_PREFIX = 'Auto: ';
const MAX_INDIVIDUAL_RECIPIENT_NAME_LENGTH = 200;

function isAutomaticAward(award: EventAward): boolean {
  return award.name.startsWith(AUTO_AWARD_NAME_PREFIX);
}

function formatIndividualRecipient(r: IndividualRecipient): string {
  if (r.team_number != null) {
    const teamLabel = r.team_name
      ? `#${r.team_number} ${r.team_name}`
      : `#${r.team_number}`;
    return `${r.name} (${teamLabel})`;
  }
  return r.name;
}

function normalizeEventAward(award: EventAward): EventAward {
  return {
    ...award,
    recipients: award.recipients ?? [],
    individual_recipients: award.individual_recipients ?? [],
  };
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

  // Automatic awards modal
  const [showAutomaticModal, setShowAutomaticModal] = useState(false);
  const [automaticForm, setAutomaticForm] = useState<AutomaticAwardSettings>({
    ...DEFAULT_AUTOMATIC_AWARD_SETTINGS,
  });
  const [automaticPreview, setAutomaticPreview] =
    useState<AutomaticAwardsPreviewResponse | null>(null);
  const [loadingAutomaticPreview, setLoadingAutomaticPreview] = useState(false);
  const [automaticPreviewError, setAutomaticPreviewError] = useState<
    string | null
  >(null);

  // Recipient controls
  const [addingRecipientForAwardId, setAddingRecipientForAwardId] = useState<
    number | null
  >(null);
  const [recipientTeamId, setRecipientTeamId] = useState('');
  const [addingIndividualForAwardId, setAddingIndividualForAwardId] = useState<
    number | null
  >(null);
  const [individualName, setIndividualName] = useState('');
  const [individualTeamId, setIndividualTeamId] = useState('');

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
      const awards = (await res.json()) as EventAward[];
      setEventAwards(awards.map(normalizeEventAward));
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

  const fetchAutomaticPreview = useCallback(
    async (settings: AutomaticAwardSettings) => {
      if (!selectedEventId) return;
      setLoadingAutomaticPreview(true);
      setAutomaticPreviewError(null);
      try {
        const params = new URLSearchParams({
          de_top_n: String(settings.de_top_n),
          per_bracket_overall_top_n: String(settings.per_bracket_overall_top_n),
          seeding_top_n: String(settings.seeding_top_n),
        });
        const res = await fetch(
          `/awards/event/${selectedEventId}/automatic/preview?${params}`,
          { credentials: 'include' },
        );
        const data = (await res.json()) as AutomaticAwardsPreviewResponse & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? 'Failed to preview automatic awards');
        }
        setAutomaticPreview(data);
      } catch (err) {
        setAutomaticPreview(null);
        setAutomaticPreviewError(
          err instanceof Error
            ? err.message
            : 'Failed to preview automatic awards',
        );
      } finally {
        setLoadingAutomaticPreview(false);
      }
    },
    [selectedEventId],
  );

  const openAutomaticModal = async () => {
    if (!selectedEventId) return;
    setShowAutomaticModal(true);
    setAutomaticPreview(null);
    setAutomaticPreviewError(null);
    setLoadingAutomaticPreview(true);
    try {
      const res = await fetch(
        `/awards/event/${selectedEventId}/automatic/preview`,
        { credentials: 'include' },
      );
      const data = (await res.json()) as AutomaticAwardsPreviewResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.error ?? 'Failed to load automatic award settings',
        );
      }
      setAutomaticForm({ ...data.settings });
      setAutomaticPreview(data);
    } catch (err) {
      setAutomaticPreviewError(
        err instanceof Error
          ? err.message
          : 'Failed to load automatic award settings',
      );
    } finally {
      setLoadingAutomaticPreview(false);
    }
  };

  const handleAutomaticFormChange = (
    key: keyof AutomaticAwardSettings,
    value: number,
  ) => {
    const next = { ...automaticForm, [key]: value };
    setAutomaticForm(next);
    void fetchAutomaticPreview(next);
  };

  const countPlannedAwards = (
    preview: AutomaticAwardsPreviewResponse | null,
  ): number => {
    if (!preview) return 0;
    const auto = preview.automatic;
    let count = 0;
    for (const b of auto.de) count += b.placements.length;
    for (const b of auto.perBracketOverall) count += b.placements.length;
    count += auto.seeding?.placements.length ?? 0;
    return count;
  };

  const handleApplyAutomaticAwards = async () => {
    if (!selectedEventId) return;
    setApplyingAutomatic(true);
    try {
      const res = await fetch(`/awards/event/${selectedEventId}/automatic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...automaticForm,
          acknowledge_warnings: Boolean(automaticPreview?.hasWarnings),
        }),
      });
      const data = (await res.json()) as {
        created?: number;
        removed?: number;
        error?: string;
        requires_acknowledgement?: boolean;
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
      setShowAutomaticModal(false);
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

  const handleMoveAward = async (
    award: EventAward,
    direction: -1 | 1,
    group: EventAward[],
  ) => {
    const idx = group.findIndex((a) => a.id === award.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= group.length) return;

    const other = group[swapIdx];
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

  const handleAddIndividualRecipient = async (awardId: number) => {
    const trimmedName = individualName.trim();
    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }
    try {
      const body: { name: string; team_id?: number } = { name: trimmedName };
      if (individualTeamId) {
        body.team_id = Number(individualTeamId);
      }
      const res = await fetch(
        `/awards/event-awards/${awardId}/individual-recipients`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success('Individual added');
      setIndividualName('');
      setIndividualTeamId('');
      setAddingIndividualForAwardId(null);
      await fetchEventAwards();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleRemoveIndividualRecipient = async (
    awardId: number,
    recipientId: number,
  ) => {
    try {
      const res = await fetch(
        `/awards/event-awards/${awardId}/individual-recipients/${recipientId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to remove');
      toast.success('Individual removed');
      await fetchEventAwards();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  // ── Render ──

  const manualAwards = eventAwards.filter((a) => !isAutomaticAward(a));
  const automaticAwards = eventAwards.filter(isAutomaticAward);

  const templateTableColumns: UnifiedColumnDef<AwardTemplate>[] = [
    {
      kind: 'data',
      id: 'name',
      header: { full: 'Name' },
      renderCell: (t) => t.name,
    },
    {
      kind: 'data',
      id: 'description',
      header: { full: 'Description' },
      renderCell: (t) => (
        <span style={{ color: 'var(--secondary-color)' }}>
          {t.description || '—'}
        </span>
      ),
    },
    {
      kind: 'data',
      id: 'actions',
      header: { full: 'Actions' },
      renderCell: (t) => (
        <>
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
        </>
      ),
    },
  ];

  const renderAwardCard = (
    award: EventAward,
    group: EventAward[],
    idx: number,
  ) => (
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
            onClick={() => handleMoveAward(award, -1, group)}
            title="Move up"
          >
            ▲
          </button>
          <button
            className="btn btn-secondary"
            disabled={idx === group.length - 1}
            onClick={() => handleMoveAward(award, 1, group)}
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
        <strong style={{ fontSize: '0.9rem' }}>Recipients</strong>

        <div style={{ marginTop: '0.5rem' }}>
          <strong style={{ fontSize: '0.85rem' }}>Teams:</strong>
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
                    onClick={() => handleRemoveRecipient(award.id, r.team_id)}
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
                flexWrap: 'wrap',
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
                    (t) => !award.recipients.some((r) => r.team_id === t.id),
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
                setAddingIndividualForAwardId(null);
              }}
            >
              + Add team
            </button>
          )}
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <strong style={{ fontSize: '0.85rem' }}>Individuals:</strong>
          {award.individual_recipients.length === 0 ? (
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
              {award.individual_recipients.map((r) => (
                <li key={r.id}>
                  {formatIndividualRecipient(r)}
                  <button
                    className="btn btn-danger"
                    style={{
                      marginLeft: '0.5rem',
                      padding: '0.1rem 0.4rem',
                      fontSize: '0.75rem',
                    }}
                    onClick={() =>
                      handleRemoveIndividualRecipient(award.id, r.id)
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {addingIndividualForAwardId === award.id ? (
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginTop: '0.5rem',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <input
                className="field-input"
                type="text"
                placeholder="Name"
                value={individualName}
                maxLength={MAX_INDIVIDUAL_RECIPIENT_NAME_LENGTH}
                onChange={(e) => setIndividualName(e.target.value)}
                style={{ maxWidth: '200px' }}
              />
              <select
                className="field-input"
                value={individualTeamId}
                onChange={(e) => setIndividualTeamId(e.target.value)}
                style={{ maxWidth: '220px' }}
              >
                <option value="">— No team —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.team_number} {t.team_name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                disabled={!individualName.trim()}
                onClick={() => handleAddIndividualRecipient(award.id)}
              >
                Add
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setAddingIndividualForAwardId(null);
                  setIndividualName('');
                  setIndividualTeamId('');
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
                setAddingIndividualForAwardId(award.id);
                setIndividualName('');
                setIndividualTeamId('');
                setAddingRecipientForAwardId(null);
              }}
            >
              + Add individual
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="awards-tab">
      {loading && <p style={{ color: 'var(--secondary-color)' }}>Loading...</p>}

      {/* Section A: Event awards */}
      {!selectedEventId ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to manage awards.
          </p>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3>Event Awards</h3>
          <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
            Awards for this event. Published alongside final scores.
          </p>

          <button
            className="btn btn-primary"
            onClick={handleCreateAward}
            style={{ marginBottom: '1rem' }}
          >
            + Add Award
          </button>

          {manualAwards.length === 0 ? (
            <p style={{ color: 'var(--secondary-color)' }}>No awards yet.</p>
          ) : (
            <div>
              {manualAwards.map((award, idx) =>
                renderAwardCard(award, manualAwards, idx),
              )}
            </div>
          )}

          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <h4 style={{ margin: '0 0 0.75rem' }}>Automatic awards</h4>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={applyingAutomatic}
              onClick={() => void openAutomaticModal()}
              style={{ marginBottom: '0.5rem' }}
            >
              Add automatic awards (from results)
            </button>
            <p
              style={{
                color: 'var(--secondary-color)',
                fontSize: '0.9rem',
                marginBottom: '1rem',
              }}
            >
              Automatic awards use the same rules as the spectator view (DE
              placement, per-bracket overall, seeding). Configure top-N counts
              in the modal. They are stored as event awards whose names start
              with &quot;Auto:&quot;; applying replaces previous automatic
              awards with a fresh calculation.
            </p>

            {automaticAwards.length === 0 ? (
              <p style={{ color: 'var(--secondary-color)' }}>
                No automatic awards yet.
              </p>
            ) : (
              <div>
                {automaticAwards.map((award, idx) =>
                  renderAwardCard(award, automaticAwards, idx),
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section B: Global templates */}
      <div className="card">
        <h3>Award Templates</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
          Reusable award definitions. Changes here do not affect awards already
          added to events.
        </p>
        <button className="btn btn-primary" onClick={handleCreateTemplate}>
          + New Template
        </button>
        {templates.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <UnifiedTable
              columns={templateTableColumns}
              rows={templates}
              getRowKey={(t) => t.id}
              headerLabelVariant="none"
            />
          </div>
        )}
      </div>

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

      {/* Automatic awards modal */}
      {showAutomaticModal && (
        <div
          className="modal show"
          onClick={() => !applyingAutomatic && setShowAutomaticModal(false)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: '640px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="close"
              onClick={() => !applyingAutomatic && setShowAutomaticModal(false)}
            >
              &times;
            </span>
            <h3>Automatic awards</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1rem',
                lineHeight: 1.5,
              }}
            >
              Choose how many top places to generate for each category. Use 0 to
              disable a category. Applying replaces existing &quot;Auto:&quot;
              awards for this event.
            </p>

            {(() => {
              const maxN = automaticPreview?.teamCount ?? teams.length;
              const options = Array.from({ length: maxN + 1 }, (_, i) => i);
              const selectStyle = { maxWidth: '12rem' } as const;
              return (
                <>
                  <div className="form-group">
                    <label htmlFor="auto-de-top-n">Top N DE placements</label>
                    <select
                      id="auto-de-top-n"
                      className="field-input"
                      style={selectStyle}
                      value={automaticForm.de_top_n}
                      disabled={loadingAutomaticPreview && !automaticPreview}
                      onChange={(e) =>
                        handleAutomaticFormChange(
                          'de_top_n',
                          Number(e.target.value),
                        )
                      }
                    >
                      {options.map((n) => (
                        <option key={`de-${n}`} value={n}>
                          {n === 0 ? '0 (disabled)' : n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="auto-bracket-top-n">
                      Top N per-bracket overall placements
                    </label>
                    <select
                      id="auto-bracket-top-n"
                      className="field-input"
                      style={selectStyle}
                      value={automaticForm.per_bracket_overall_top_n}
                      disabled={loadingAutomaticPreview && !automaticPreview}
                      onChange={(e) =>
                        handleAutomaticFormChange(
                          'per_bracket_overall_top_n',
                          Number(e.target.value),
                        )
                      }
                    >
                      {options.map((n) => (
                        <option key={`ob-${n}`} value={n}>
                          {n === 0 ? '0 (disabled)' : n}
                        </option>
                      ))}
                    </select>
                    <p
                      style={{
                        color: 'var(--secondary-color)',
                        fontSize: '0.85rem',
                        marginTop: '0.35rem',
                      }}
                    >
                      Only generated when the event has multiple brackets and
                      each bracket is fully ranked.
                    </p>
                  </div>
                  <div className="form-group">
                    <label htmlFor="auto-seeding-top-n">
                      Top N seeding places
                    </label>
                    <select
                      id="auto-seeding-top-n"
                      className="field-input"
                      style={selectStyle}
                      value={automaticForm.seeding_top_n}
                      disabled={loadingAutomaticPreview && !automaticPreview}
                      onChange={(e) =>
                        handleAutomaticFormChange(
                          'seeding_top_n',
                          Number(e.target.value),
                        )
                      }
                    >
                      {options.map((n) => (
                        <option key={`seed-${n}`} value={n}>
                          {n === 0 ? '0 (disabled)' : n}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              );
            })()}

            {loadingAutomaticPreview && (
              <p style={{ color: 'var(--secondary-color)' }}>
                Updating preview…
              </p>
            )}
            {automaticPreviewError && (
              <p style={{ color: 'var(--danger-color, #b00020)' }}>
                {automaticPreviewError}
              </p>
            )}

            {automaticPreview && !automaticPreviewError && (
              <div
                style={{
                  marginTop: '0.75rem',
                  marginBottom: '1rem',
                  padding: '0.75rem 1rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  background: 'var(--surface-color, transparent)',
                }}
              >
                <p style={{ margin: '0 0 0.5rem' }}>
                  Preview: {countPlannedAwards(automaticPreview)} award
                  {countPlannedAwards(automaticPreview) === 1 ? '' : 's'} will
                  be created
                  {automaticPreview.teamCount === 0
                    ? ' (event has no teams).'
                    : '.'}
                </p>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '1.25rem',
                    color: 'var(--secondary-color)',
                    fontSize: '0.9rem',
                  }}
                >
                  <li>
                    DE:{' '}
                    {automaticPreview.automatic.de.reduce(
                      (sum, b) => sum + b.placements.length,
                      0,
                    )}{' '}
                    placement
                    {automaticPreview.automatic.de.reduce(
                      (sum, b) => sum + b.placements.length,
                      0,
                    ) === 1
                      ? ''
                      : 's'}
                  </li>
                  <li>
                    Per-bracket overall:{' '}
                    {automaticPreview.automatic.perBracketOverall.reduce(
                      (sum, b) => sum + b.placements.length,
                      0,
                    )}{' '}
                    placement
                    {automaticPreview.automatic.perBracketOverall.reduce(
                      (sum, b) => sum + b.placements.length,
                      0,
                    ) === 1
                      ? ''
                      : 's'}
                  </li>
                  <li>
                    Seeding:{' '}
                    {automaticPreview.automatic.seeding?.placements.length ?? 0}{' '}
                    place
                    {(automaticPreview.automatic.seeding?.placements.length ??
                      0) === 1
                      ? ''
                      : 's'}
                  </li>
                </ul>
              </div>
            )}

            {automaticPreview?.hasWarnings && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem 1rem',
                  border: '1px solid var(--warning-border, #c9a227)',
                  borderRadius: '4px',
                  background: 'var(--warning-bg, rgba(201, 162, 39, 0.12))',
                }}
              >
                <strong>Warnings</strong>
                <p
                  style={{
                    margin: '0.35rem 0 0.75rem',
                    fontSize: '0.9rem',
                    lineHeight: 1.45,
                  }}
                >
                  Review these common issues before applying. You can still
                  apply anyway.
                </p>
                {automaticPreview.diagnostics.zeroScoreIssues.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>
                      Teams with a zero or missing score component
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: '1.25rem',
                        maxHeight: '10rem',
                        overflowY: 'auto',
                        fontSize: '0.9rem',
                      }}
                    >
                      {automaticPreview.diagnostics.zeroScoreIssues.map(
                        (issue) => (
                          <li key={issue.team_id}>
                            #{issue.team_number} {issue.team_name}:{' '}
                            {issue.components
                              .map((c) => ZERO_COMPONENT_LABELS[c])
                              .join(', ')}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
                {automaticPreview.diagnostics.duplicateBracketWeights.length >
                  0 && (
                  <div>
                    <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>
                      Multiple brackets share the same weight
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: '1.25rem',
                        fontSize: '0.9rem',
                      }}
                    >
                      {automaticPreview.diagnostics.duplicateBracketWeights.map(
                        (group) => (
                          <li key={group.weight}>
                            Weight {group.weight}:{' '}
                            {group.brackets.map((b) => b.name).join(', ')}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'flex-end',
                marginTop: '1rem',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAutomaticModal(false)}
                disabled={applyingAutomatic}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  automaticPreview?.hasWarnings
                    ? 'btn btn-warning'
                    : 'btn btn-primary'
                }
                disabled={
                  applyingAutomatic ||
                  loadingAutomaticPreview ||
                  Boolean(automaticPreviewError) ||
                  !automaticPreview
                }
                onClick={() => void handleApplyAutomaticAwards()}
              >
                {applyingAutomatic
                  ? 'Applying…'
                  : automaticPreview?.hasWarnings
                    ? 'Apply anyway'
                    : 'Apply automatic awards'}
              </button>
            </div>
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
