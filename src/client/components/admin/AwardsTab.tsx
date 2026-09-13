import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { teamsQueryOptions } from '../../queries/teams';
import {
  automaticAwardPreviewQueryOptions,
  automaticAwardSettingsQueryOptions,
  awardTemplatesQueryOptions,
  eventAwardsQueryOptions,
  useAwardMutations,
} from '../../queries/awards';
import QueryFeedback, { queryData } from '../QueryFeedback';
import {
  DEFAULT_AUTOMATIC_AWARD_SETTINGS,
  type AutomaticAwardSettings,
  type AutomaticAwardsPreviewResponse,
  type ZeroScoreComponent,
} from '@shared/automaticAwards';
import {
  AWARD_TYPE_LABELS,
  DEFAULT_AWARD_TYPE,
  type AwardType,
} from '@shared/awards';
import type { Team } from '../../api/teams';
import type { AwardTemplate, EventAward } from '../../api/awards';
import AwardRecipientModal from './AwardRecipientModal';
import '../Modal.css';
import './AwardsTab.css';

const ZERO_COMPONENT_LABELS: Record<ZeroScoreComponent, string> = {
  documentation: 'documentation',
  seeding: 'seeding',
  double_seeding: 'double seeding',
  weighted_de: 'weighted DE',
};

const AUTO_AWARD_NAME_PREFIX = 'Auto: ';
const MAX_INDIVIDUAL_RECIPIENT_NAME_LENGTH = 200;

function isAutomaticAward(award: EventAward): boolean {
  return award.name.startsWith(AUTO_AWARD_NAME_PREFIX);
}

function formatIndividualRecipient(
  r: EventAward['individual_recipients'][number],
): string {
  if (r.team_number != null) {
    const teamLabel = r.team_name
      ? `#${r.team_number} ${r.team_name}`
      : `#${r.team_number}`;
    return `${r.name} (${teamLabel})`;
  }
  return r.name;
}

const EMPTY_TEMPLATES: AwardTemplate[] = [];
const EMPTY_AWARDS: EventAward[] = [];
const EMPTY_TEAMS: Team[] = [];

export default function AwardsTab() {
  const { selectedEvent } = useEvent();
  const { user, loading: authLoading } = useAuth();
  const selectedEventId = selectedEvent?.id ?? null;
  const userId = user?.id ?? 0;
  const enabled = Boolean(user && !authLoading && selectedEventId);
  const {
    saveTemplate,
    removeTemplate,
    saveAward,
    removeAward,
    removeRecipient,
    addIndividual,
    removeIndividual,
    applyAutomatic,
    reorder,
  } = useAwardMutations();

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AwardTemplate | null>(
    null,
  );
  const [templateForm, setTemplateForm] = useState({
    name: '',
    description: '',
    award_type: DEFAULT_AWARD_TYPE as AwardType,
  });

  const [showAwardModal, setShowAwardModal] = useState(false);
  const [editingAward, setEditingAward] = useState<EventAward | null>(null);
  const [awardForm, setAwardForm] = useState({
    name: '',
    description: '',
    template_award_id: '',
    award_type: DEFAULT_AWARD_TYPE as AwardType,
    mode: 'manual' as 'manual' | 'template',
  });

  const [recipientModalAward, setRecipientModalAward] =
    useState<EventAward | null>(null);

  const [showAutomaticModal, setShowAutomaticModal] = useState(false);
  const [automaticForm, setAutomaticForm] =
    useState<AutomaticAwardSettings | null>(null);
  const [automaticSessionEventId, setAutomaticSessionEventId] = useState<
    number | null
  >(null);

  const [addingIndividualForAwardId, setAddingIndividualForAwardId] = useState<
    number | null
  >(null);
  const [individualName, setIndividualName] = useState('');
  const [individualTeamId, setIndividualTeamId] = useState('');

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const templatesQuery = useQuery({
    ...awardTemplatesQueryOptions(userId),
    enabled: Boolean(user && !authLoading),
  });
  const awardsQuery = useQuery({
    ...eventAwardsQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const teamsQuery = useQuery({
    ...teamsQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const templates = queryData(templatesQuery) ?? EMPTY_TEMPLATES;
  const eventAwards = queryData(awardsQuery) ?? EMPTY_AWARDS;
  const teams = queryData(teamsQuery) ?? EMPTY_TEAMS;
  const loading =
    templatesQuery.isLoading || awardsQuery.isLoading || teamsQuery.isLoading;
  const errorQuery = [templatesQuery, awardsQuery, teamsQuery].find(
    (query) => query.isError,
  );

  const settingsQuery = useQuery({
    ...automaticAwardSettingsQueryOptions(userId, selectedEventId ?? 0),
    enabled: Boolean(
      user && !authLoading && selectedEventId && showAutomaticModal,
    ),
  });
  if (
    showAutomaticModal &&
    automaticForm == null &&
    settingsQuery.data &&
    automaticSessionEventId === selectedEventId
  ) {
    setAutomaticForm({ ...settingsQuery.data.settings });
  }
  if (showAutomaticModal && automaticSessionEventId !== selectedEventId) {
    setAutomaticSessionEventId(selectedEventId);
    setAutomaticForm(null);
  }

  const previewQuery = useQuery({
    ...automaticAwardPreviewQueryOptions(
      userId,
      selectedEventId ?? 0,
      automaticForm ?? DEFAULT_AUTOMATIC_AWARD_SETTINGS,
    ),
    enabled: Boolean(
      user &&
      !authLoading &&
      selectedEventId &&
      showAutomaticModal &&
      automaticForm,
    ),
  });
  const automaticPreview = queryData(previewQuery) ?? null;
  const loadingAutomaticPreview =
    (settingsQuery.isLoading && automaticForm == null) ||
    previewQuery.isFetching;
  const automaticPreviewError = previewQuery.isError
    ? previewQuery.error.message
    : settingsQuery.isError && automaticForm == null
      ? settingsQuery.error.message
      : null;

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({
      name: '',
      description: '',
      award_type: DEFAULT_AWARD_TYPE,
    });
    setShowTemplateModal(true);
  };

  const handleEditTemplate = (t: AwardTemplate) => {
    setEditingTemplate(t);
    setTemplateForm({
      name: t.name,
      description: t.description ?? '',
      award_type: t.award_type ?? DEFAULT_AWARD_TYPE,
    });
    setShowTemplateModal(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!templateForm.name.trim()) {
      toast.error('Name is required');
      return;
    }
    try {
      await saveTemplate.mutateAsync({
        userId: user.id,
        templateId: editingTemplate?.id,
        data: {
          name: templateForm.name.trim(),
          description: templateForm.description.trim() || null,
          award_type: templateForm.award_type,
        },
      });
      toast.success(editingTemplate ? 'Template updated' : 'Template created');
      setShowTemplateModal(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const handleDeleteTemplate = async (t: AwardTemplate) => {
    if (!user) return;
    const ok = await confirm({
      title: 'Delete Template',
      message: `Delete award template "${t.name}"? This will not affect existing event awards.`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!ok) return;
    try {
      await removeTemplate.mutateAsync({ userId: user.id, templateId: t.id });
      toast.success('Template deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleCreateAward = () => {
    setEditingAward(null);
    setAwardForm({
      name: '',
      description: '',
      template_award_id: '',
      award_type: DEFAULT_AWARD_TYPE,
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
      award_type: a.award_type ?? DEFAULT_AWARD_TYPE,
      mode: 'manual',
    });
    setShowAwardModal(true);
  };

  const handleSaveAward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedEventId) return;
    if (awardForm.mode === 'manual' && !awardForm.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (awardForm.mode === 'template' && !awardForm.template_award_id) {
      toast.error('Select a template');
      return;
    }
    try {
      if (editingAward) {
        await saveAward.mutateAsync({
          userId: user.id,
          eventId: selectedEventId,
          awardId: editingAward.id,
          data: {
            name: awardForm.name.trim(),
            description: awardForm.description.trim() || null,
            award_type: awardForm.award_type,
          },
        });
        toast.success('Award updated');
      } else {
        const data =
          awardForm.mode === 'template'
            ? {
                award_type: awardForm.award_type,
                template_award_id: Number(awardForm.template_award_id),
              }
            : {
                award_type: awardForm.award_type,
                name: awardForm.name.trim(),
                description: awardForm.description.trim() || null,
              };
        await saveAward.mutateAsync({
          userId: user.id,
          eventId: selectedEventId,
          data,
        });
        toast.success('Award added');
      }
      setShowAwardModal(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const openAutomaticModal = () => {
    setShowAutomaticModal(true);
    setAutomaticSessionEventId(selectedEventId);
    setAutomaticForm(null);
  };

  const handleAutomaticFormChange = <K extends keyof AutomaticAwardSettings>(
    key: K,
    value: AutomaticAwardSettings[K],
  ) => {
    setAutomaticForm((prev) => ({
      ...(prev ?? DEFAULT_AUTOMATIC_AWARD_SETTINGS),
      [key]: value,
    }));
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
    if (!selectedEventId || !user || !automaticForm) return;
    try {
      const data = await applyAutomatic.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        data: {
          ...automaticForm,
          acknowledge_warnings: Boolean(automaticPreview?.hasWarnings),
        },
      });
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
      setAutomaticForm(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to apply automatic awards',
      );
    }
  };

  const handleDeleteAward = async (a: EventAward) => {
    if (!user || !selectedEventId) return;
    const ok = await confirm({
      title: 'Delete Award',
      message: `Delete award "${a.name}" and all its recipients?`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!ok) return;
    try {
      await removeAward.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        awardId: a.id,
      });
      toast.success('Award deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleMoveAward = async (
    award: EventAward,
    direction: -1 | 1,
    group: EventAward[],
  ) => {
    if (!user || !selectedEventId) return;
    const idx = group.findIndex((a) => a.id === award.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= group.length) return;
    const other = group[swapIdx];
    const results = await reorder.mutateAsync({
      userId: user.id,
      eventId: selectedEventId,
      updates: [
        { awardId: award.id, sort_order: other.sort_order },
        { awardId: other.id, sort_order: award.sort_order },
      ],
    });
    const failures = results.filter((row) => !row.ok);
    if (failures.length > 0) {
      toast.error(
        failures.length === results.length
          ? 'Failed to reorder'
          : `Reordered with ${failures.length} failure(s)`,
      );
    }
  };

  const handleRemoveRecipient = async (awardId: number, teamId: number) => {
    if (!user || !selectedEventId) return;
    try {
      await removeRecipient.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        awardId,
        teamId,
      });
      toast.success('Recipient removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  const handleAddIndividualRecipient = async (awardId: number) => {
    if (!user || !selectedEventId) return;
    const trimmedName = individualName.trim();
    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }
    try {
      await addIndividual.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        awardId,
        name: trimmedName,
        teamId: individualTeamId ? Number(individualTeamId) : undefined,
      });
      toast.success('Individual added');
      setIndividualName('');
      setIndividualTeamId('');
      setAddingIndividualForAwardId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleRemoveIndividualRecipient = async (
    awardId: number,
    recipientId: number,
  ) => {
    if (!user || !selectedEventId) return;
    try {
      await removeIndividual.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        awardId,
        recipientId,
      });
      toast.success('Individual removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  const applyingAutomatic = applyAutomatic.isPending;
  const savingTemplate = saveTemplate.isPending;
  const savingAward = saveAward.isPending;

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
      id: 'award_type',
      header: { full: 'Type' },
      renderCell: (t) => AWARD_TYPE_LABELS[t.award_type ?? DEFAULT_AWARD_TYPE],
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
          <span className="award-type-badge">
            {AWARD_TYPE_LABELS[award.award_type ?? DEFAULT_AWARD_TYPE]}
          </span>
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

          <button
            className="btn btn-secondary"
            style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
            onClick={() => {
              setRecipientModalAward(award);
              setAddingIndividualForAwardId(null);
            }}
          >
            + Add team
          </button>
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
      {errorQuery ? <QueryFeedback query={errorQuery} /> : null}
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
              <div className="form-group">
                <label htmlFor="tmpl-type">Award type *</label>
                <select
                  id="tmpl-type"
                  className="field-input"
                  value={templateForm.award_type}
                  onChange={(e) =>
                    setTemplateForm({
                      ...templateForm,
                      award_type: e.target.value as AwardType,
                    })
                  }
                >
                  <option value="trophy">Trophy</option>
                  <option value="certificate">Certificate</option>
                </select>
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
              const form = automaticForm ?? DEFAULT_AUTOMATIC_AWARD_SETTINGS;
              const maxN = automaticPreview?.teamCount ?? teams.length;
              const options = Array.from({ length: maxN + 1 }, (_, i) => i);
              const selectStyle = { maxWidth: '12rem' } as const;
              const typeSelect = (
                id: string,
                key:
                  | 'de_award_type'
                  | 'per_bracket_overall_award_type'
                  | 'seeding_award_type',
                value: AwardType,
              ) => (
                <div className="form-group">
                  <label htmlFor={id}>Award type</label>
                  <select
                    id={id}
                    className="field-input"
                    style={selectStyle}
                    value={value}
                    disabled={loadingAutomaticPreview && !automaticPreview}
                    onChange={(e) =>
                      handleAutomaticFormChange(
                        key,
                        e.target.value as AwardType,
                      )
                    }
                  >
                    <option value="trophy">Trophy</option>
                    <option value="certificate">Certificate</option>
                  </select>
                </div>
              );
              return (
                <>
                  <div className="form-group">
                    <label htmlFor="auto-de-top-n">Top N DE placements</label>
                    <select
                      id="auto-de-top-n"
                      className="field-input"
                      style={selectStyle}
                      value={form.de_top_n}
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
                  {typeSelect(
                    'auto-de-award-type',
                    'de_award_type',
                    form.de_award_type,
                  )}
                  <div className="form-group">
                    <label htmlFor="auto-bracket-top-n">
                      Top N per-bracket overall placements
                    </label>
                    <select
                      id="auto-bracket-top-n"
                      className="field-input"
                      style={selectStyle}
                      value={form.per_bracket_overall_top_n}
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
                  {typeSelect(
                    'auto-bracket-award-type',
                    'per_bracket_overall_award_type',
                    form.per_bracket_overall_award_type,
                  )}
                  <div className="form-group">
                    <label htmlFor="auto-seeding-top-n">
                      Top N seeding places
                    </label>
                    <select
                      id="auto-seeding-top-n"
                      className="field-input"
                      style={selectStyle}
                      value={form.seeding_top_n}
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
                  {typeSelect(
                    'auto-seeding-award-type',
                    'seeding_award_type',
                    form.seeding_award_type,
                  )}
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
                    onChange={(e) => {
                      const templateId = e.target.value;
                      const tmpl = templates.find(
                        (t) => String(t.id) === templateId,
                      );
                      setAwardForm({
                        ...awardForm,
                        template_award_id: templateId,
                        award_type: tmpl?.award_type ?? awardForm.award_type,
                      });
                    }}
                    required
                  >
                    <option value="">— Select —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (
                        {AWARD_TYPE_LABELS[t.award_type ?? DEFAULT_AWARD_TYPE]})
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

              <div className="form-group">
                <label htmlFor="award-type">Award type *</label>
                <select
                  id="award-type"
                  className="field-input"
                  value={awardForm.award_type}
                  onChange={(e) =>
                    setAwardForm({
                      ...awardForm,
                      award_type: e.target.value as AwardType,
                    })
                  }
                >
                  <option value="trophy">Trophy</option>
                  <option value="certificate">Certificate</option>
                </select>
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

      {recipientModalAward && selectedEventId != null && (
        <AwardRecipientModal
          eventId={selectedEventId}
          awardId={recipientModalAward.id}
          awardName={recipientModalAward.name}
          existingRecipientTeamIds={recipientModalAward.recipients.map(
            (r) => r.team_id,
          )}
          onClose={() => setRecipientModalAward(null)}
          onError={(msg) => toast.error(msg)}
          onSuccess={(msg) => toast.success(msg)}
        />
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
