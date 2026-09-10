import type { TeamInitialsSlot } from '../../shared/teamInitials';

interface TeamInitialsFieldsProps {
  slots: TeamInitialsSlot[];
  values: Record<string, unknown>;
  onChange: (fieldId: string, value: string) => void;
  disabled?: boolean;
  required?: boolean;
}

export default function TeamInitialsFields({
  slots,
  values,
  onChange,
  disabled = false,
  required = true,
}: TeamInitialsFieldsProps) {
  if (slots.length === 0) {
    return null;
  }

  return (
    <div className="team-initials-container">
      <h3 className="winner-select-title">Team Initials</h3>
      <p className="bracket-result-help">
        Initials of each participating team&apos;s representative. Required for
        normal scores, no contest, and disqualification.
      </p>
      <div className="team-initials-fields">
        {slots.map((slot) => (
          <label
            key={slot.id}
            className="team-initials-label"
            htmlFor={slot.id}
          >
            {slot.label}
            <input
              id={slot.id}
              type="text"
              className="score-input"
              placeholder="Initials of team representative"
              value={String(values[slot.id] ?? '')}
              onChange={(event) => onChange(slot.id, event.target.value)}
              required={required}
              disabled={disabled}
              autoComplete="off"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
