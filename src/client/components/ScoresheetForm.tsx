import React, { useState } from 'react';
import {
  type ScoresheetField,
  type ScoresheetSchema,
} from '../../shared/domain/scoresheetSchema';
import {
  findBracketGameBySelection,
  getBracketSourceEventId,
  isEventScopedBracketSource,
} from './scoresheetUtils';
import { ScoresheetFieldList } from './scoresheet/ScoresheetFieldList';
import { useCalculatedValues } from './scoresheet/formulaEngine';
import { useQueueItems } from './scoresheet/useQueueItems';
import { useBracketGames } from './scoresheet/useBracketGames';
import { useTeamsLookup } from './scoresheet/useTeamsLookup';
import { useDynamicData } from './scoresheet/useDynamicData';
import { lookupTeamName as lookupTeamNameFn } from './scoresheet/scoresheetData';
import { buildScorePayload, submitScore } from './scoresheet/submitScore';
import { GameAreasOverlay } from './scoresheet/GameAreasOverlay';
import {
  NotificationBanner,
  type ScoresheetNotification,
} from './scoresheet/NotificationBanner';
import { WinnerSelect } from './scoresheet/WinnerSelect';
import '../pages/Scoresheet.css';

interface ScoresheetFormProps {
  template: { id: number; schema: ScoresheetSchema };
}

export default function ScoresheetForm({ template }: ScoresheetFormProps) {
  const schema = template.schema;
  const isHeadToHead = schema.mode === 'head-to-head';
  const gameAreasImage = schema.gameAreasImage;
  const isEventScopedBracket = isEventScopedBracketSource(
    schema.bracketSource,
    schema.eventId,
  );
  const bracketSourceEventId = getBracketSourceEventId(
    schema.bracketSource,
    schema.eventId,
  );

  const useQueueForSeeding = !!(
    schema.eventId &&
    schema.scoreDestination === 'db' &&
    !isHeadToHead
  );

  const getInitialFormData = (): Record<string, unknown> => {
    const initial: Record<string, unknown> = {};
    if (!useQueueForSeeding) {
      const cachedRound = localStorage.getItem('lastRoundNumber');
      if (cachedRound) initial.round = cachedRound;
    }

    schema.fields.forEach((field) => {
      if ('defaultValue' in field && field.defaultValue !== undefined) {
        initial[field.id] = field.defaultValue;
      } else if ('startValue' in field && field.startValue !== undefined) {
        initial[field.id] = field.startValue;
      }
    });

    return initial;
  };

  const [formData, setFormData] =
    useState<Record<string, unknown>>(getInitialFormData);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>(
    {},
  );
  const [notification, setNotification] =
    useState<ScoresheetNotification | null>(null);
  const [showGameAreas, setShowGameAreas] = useState(false);

  const calculatedValues = useCalculatedValues(schema.fields, formData);

  const dynamicData = useDynamicData(schema, useQueueForSeeding);
  const { items: queueItems, reload: reloadQueue } = useQueueItems(
    schema.eventId,
    useQueueForSeeding,
  );
  const { games: bracketGames, reload: reloadBracketGames } = useBracketGames(
    schema,
    isEventScopedBracket,
    bracketSourceEventId,
    isHeadToHead && !!schema.bracketSource,
  );
  const teamsData = useTeamsLookup(schema, isHeadToHead);

  const showNotification = (
    message: string,
    type: 'success' | 'error' = 'success',
  ) => {
    setNotification({ message, type });

    setTimeout(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }, 100);

    setTimeout(() => {
      setNotification(null);
    }, 2000);
  };

  const handleReset = () => {
    if (
      window.confirm(
        'Are you sure you want to reset all fields? This cannot be undone.',
      )
    ) {
      setFormData(getInitialFormData());
      setTouchedFields({});
      showNotification('Form has been reset', 'success');
    }
  };

  const lookupTeamName = (teamNumber: string): string => {
    const teamsConfig = schema.teamsDataSource;
    return lookupTeamNameFn(
      teamNumber,
      teamsData,
      teamsConfig?.teamNumberField || 'Team Number',
      teamsConfig?.teamNameField || 'Team Name',
    );
  };

  const handleQueueSelect = (queueId: string) => {
    if (!queueId) {
      setFormData((prev) => {
        const next = { ...prev };
        delete next.team_number;
        delete next.team_name;
        delete next.round;
        delete next.team_id;
        delete next.game_queue_id;
        return next;
      });
      return;
    }
    const item = queueItems.find((q) => q.id === Number(queueId));
    if (!item) return;
    setFormData((prev) => ({
      ...prev,
      team_number: String(item.seeding_team_number),
      team_name: item.seeding_team_name || `Team ${item.seeding_team_number}`,
      round: item.seeding_round,
      team_id: item.seeding_team_id,
      game_queue_id: item.id,
    }));
  };

  const handleBracketGameSelect = (selectedValue: string) => {
    const selectedGame = findBracketGameBySelection(
      bracketGames,
      selectedValue,
      isEventScopedBracket,
    );

    if (!selectedGame) {
      setFormData((prev) => {
        const next = { ...prev };
        delete next.game_number;
        delete next.bracket_game_id;
        delete next.team_a_number;
        delete next.team_a_name;
        delete next.team_a_bracket_display;
        delete next.team_b_number;
        delete next.team_b_name;
        delete next.team_b_bracket_display;
        delete next.winner;
        return next;
      });
      return;
    }

    const updates: Record<string, unknown> = {
      game_number: selectedGame.gameNumber,
      winner: '',
    };

    if (selectedGame.team1) {
      const teamNumRaw = selectedGame.team1.teamNumber;
      const teamNum = String(parseInt(teamNumRaw, 10) || teamNumRaw);
      const fullName = lookupTeamName(teamNum);
      updates.team_a_number = teamNum;
      updates.team_a_name = fullName;
      updates.team_a_bracket_display = selectedGame.team1.displayName;
    } else {
      updates.team_a_number = 'Bye';
      updates.team_a_name = 'Bye';
      updates.team_a_bracket_display = 'Bye';
    }

    if (selectedGame.team2) {
      const teamNumRaw = selectedGame.team2.teamNumber;
      const teamNum = String(parseInt(teamNumRaw, 10) || teamNumRaw);
      const fullName = lookupTeamName(teamNum);
      updates.team_b_number = teamNum;
      updates.team_b_name = fullName;
      updates.team_b_bracket_display = selectedGame.team2.displayName;
    } else {
      updates.team_b_number = 'Bye';
      updates.team_b_name = 'Bye';
      updates.team_b_bracket_display = 'Bye';
    }

    if (selectedGame.bracketGameId != null) {
      updates.bracket_game_id = selectedGame.bracketGameId;
    }

    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleInputChange = (
    fieldId: string,
    value: unknown,
    field?: ScoresheetField,
  ) => {
    if (fieldId === 'game_number' && isHeadToHead) {
      handleBracketGameSelect(String(value));
      return;
    }

    const updates: Record<string, unknown> = { [fieldId]: value };

    if (
      field &&
      'cascades' in field &&
      field.cascades &&
      !isHeadToHead &&
      field.dataSource?.type === 'db'
    ) {
      const cascades = field.cascades as Record<string, string>;
      const targetField = cascades.targetField;
      const sourceField = cascades.sourceField;
      if (targetField && sourceField) {
        const cascadeField = schema.fields.find((f) => f.id === targetField);
        const ds = field.dataSource;
        const valueField =
          ds && ds.type === 'db' ? ds.valueField || 'value' : 'value';
        if (cascadeField && dynamicData[field.id]) {
          const selectedItem = dynamicData[field.id].find(
            (item) => item[valueField] === value,
          );
          if (selectedItem) {
            updates[targetField] = selectedItem[sourceField];
          }
        }
      }
    }

    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleNumberInputTouched = (fieldId: string, touched: boolean) => {
    setTouchedFields((prev) => ({ ...prev, [fieldId]: touched }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isHeadToHead && !formData.winner) {
      alert('Please select a winner before submitting.');
      return;
    }

    if (
      isHeadToHead &&
      schema.scoreDestination === 'db' &&
      schema.eventId &&
      schema.bracketSource?.type === 'db' &&
      formData.bracket_game_id == null
    ) {
      alert('Please select a game before submitting.');
      return;
    }

    if (useQueueForSeeding && formData.game_queue_id == null) {
      alert('Please select a team and round from the queue before submitting.');
      return;
    }

    const payload = buildScorePayload({
      templateId: template.id,
      schema,
      formData,
      calculatedValues,
      teamsData,
      dynamicData,
      isHeadToHead,
    });

    const outcome = await submitScore(payload);

    if (outcome.kind === 'authError') {
      showNotification(outcome.message, 'error');
      sessionStorage.removeItem('currentTemplate');
      setTimeout(() => {
        window.location.href = '/judge';
      }, 2000);
      return;
    }
    if (outcome.kind === 'error') {
      showNotification(outcome.message, 'error');
      return;
    }

    const roundValueAtSubmit = (
      payload.body.scoreData as Record<string, { value?: unknown }> | undefined
    )?.['round']?.value;

    if (!isHeadToHead && !useQueueForSeeding && roundValueAtSubmit) {
      localStorage.setItem('lastRoundNumber', String(roundValueAtSubmit));
    }

    showNotification('Score submitted successfully!', 'success');

    if (isHeadToHead) {
      setFormData({});
      reloadBracketGames();
    } else if (useQueueForSeeding) {
      setFormData({});
      reloadQueue();
    } else {
      const currentRound = formData['round'];
      setFormData({ round: currentRound });
    }
  };

  const renderWinnerSelect = (field: ScoresheetField) => (
    <WinnerSelect
      field={field}
      formData={formData}
      calculatedValues={calculatedValues}
      onSelectWinner={(winner) => handleInputChange('winner', winner)}
    />
  );

  return (
    <>
      <NotificationBanner notification={notification} />

      {showGameAreas && gameAreasImage && (
        <GameAreasOverlay
          image={gameAreasImage}
          onClose={() => setShowGameAreas(false)}
        />
      )}

      <form onSubmit={handleSubmit} className="scoresheet-form">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '1.5rem',
            paddingBottom: '1rem',
            borderBottom: '2px solid var(--border-color)',
          }}
        >
          <div style={{ width: '60px' }}></div>

          <div
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: '1.5rem',
              fontWeight: 700,
            }}
          >
            {schema.title || ''}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.8rem',
              width: '60px',
            }}
          >
            Reset
          </button>
        </div>

        {gameAreasImage && (
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowGameAreas(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.5rem',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM3 5h18v14H3V5zm8 6H7v2h4v-2zm0-4H7v2h4V7zm0 8H7v2h4v-2zm6-4h-4v2h4v-2zm0-4h-4v2h4V7zm0 8h-4v2h4v-2z" />
              </svg>
              Game Areas
            </button>
          </div>
        )}

        {useQueueForSeeding && (
          <div className="score-field" style={{ marginBottom: '1rem' }}>
            <label className="score-label">Select from Queue</label>
            <select
              className="score-input"
              value={
                (formData.game_queue_id as string | number | undefined) ?? ''
              }
              onChange={(e) => handleQueueSelect(e.target.value)}
              required
              style={{ width: '100%', maxWidth: '400px' }}
            >
              <option value="">Select team and round...</option>
              {queueItems.length === 0 ? (
                <option value="" disabled>
                  No queue items available
                </option>
              ) : (
                queueItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.seeding_team_number} {item.seeding_team_name} – Round{' '}
                    {item.seeding_round}
                  </option>
                ))
              )}
            </select>
            {formData.game_queue_id != null && (
              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--secondary-color)',
                }}
              >
                Team {String(formData.team_number)} –{' '}
                {String(formData.team_name)} (Round {String(formData.round)})
              </div>
            )}
          </div>
        )}

        <ScoresheetFieldList
          schema={schema}
          mode="edit"
          formData={formData}
          calculatedValues={calculatedValues}
          touchedFields={touchedFields}
          onChange={handleInputChange}
          onNumberInputTouched={handleNumberInputTouched}
          dynamicData={dynamicData}
          bracket={{
            games: bracketGames,
            eventScoped: isEventScopedBracket,
            selectedGameId:
              (formData.bracket_game_id as number | string | undefined) ?? '',
            onSelect: handleBracketGameSelect,
          }}
          renderWinnerSelect={renderWinnerSelect}
          excludeHeaderFieldId={(id) =>
            useQueueForSeeding &&
            ['team_number', 'team_name', 'round'].includes(id)
          }
          showTitle={false}
          formClassName=""
        />

        <div className="scoresheet-footer">
          <button type="submit" className="btn btn-primary btn-large">
            {isHeadToHead ? 'Submit Winner' : 'Submit Score'}
          </button>
        </div>
      </form>
    </>
  );
}
