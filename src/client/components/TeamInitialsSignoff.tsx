import {
  TEAM_INITIALS_MAX_LENGTH,
  type TeamInitials,
  type TeamInitialsSlot,
} from '../../shared/teamInitials';

export interface TeamInitialsSignoffTeam {
  slot: TeamInitialsSlot;
  teamLabel: string;
}

interface TeamInitialsSignoffProps {
  teams: TeamInitialsSignoffTeam[];
  outcomeSummary?: string;
  values: TeamInitials;
  errors?: Partial<Record<TeamInitialsSlot, string>>;
  onChange?: (slot: TeamInitialsSlot, value: string) => void;
  readOnly?: boolean;
}

export function getTeamInitialsInputId(slot: TeamInitialsSlot): string {
  return `team-initials-${slot}`;
}

/**
 * Team sign-off block: each participating team's representative initials the
 * outcome shown above it. Rendered after the result controls so teams see the
 * final result before initialing.
 */
export default function TeamInitialsSignoff({
  teams,
  outcomeSummary,
  values,
  errors = {},
  onChange,
  readOnly = false,
}: TeamInitialsSignoffProps) {
  if (teams.length === 0) return null;

  return (
    <div className="team-initials-container">
      <h3 className="winner-select-title">Team Sign-off</h3>
      {outcomeSummary && (
        <p className="team-initials-summary">{outcomeSummary}</p>
      )}
      <p className="bracket-result-help">
        A representative of each team initials to confirm they have seen this
        result.
      </p>
      <div className="team-initials-fields">
        {teams.map(({ slot, teamLabel }) => {
          const error = errors[slot];
          const inputId = getTeamInitialsInputId(slot);
          return (
            <div key={slot} className="team-initials-field">
              <label className="score-label" htmlFor={inputId}>
                {teamLabel} representative initials
              </label>
              <input
                id={inputId}
                type="text"
                className={`score-input team-initials-input ${error ? 'has-error' : ''}`}
                value={values[slot] ?? ''}
                onChange={(event) => onChange?.(slot, event.target.value)}
                readOnly={readOnly}
                // Room for dotted forms like "A.B."; normalization strips them.
                maxLength={TEAM_INITIALS_MAX_LENGTH * 2}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${inputId}-error` : undefined}
              />
              {error && (
                <div
                  id={`${inputId}-error`}
                  className="team-initials-error"
                  role="alert"
                >
                  {error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
