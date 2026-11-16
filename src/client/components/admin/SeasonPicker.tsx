import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';
import type { Season } from '../../utils/eventStatus';
import type { SeasonCatalog } from '../../hooks/useSeasons';

interface SeasonPickerProps {
  id: string;
  value: number | null;
  onChange: (id: number | null) => void;
  catalog: SeasonCatalog;
  required?: boolean;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}

export default function SeasonPicker({
  id,
  value,
  onChange,
  catalog,
  required = false,
  disabled = false,
  onBusyChange,
}: SeasonPickerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [order, setOrder] = useState('0');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const createSeason = async () => {
    if (pending.current || disabled) return;
    // PostgreSQL remains authoritative for locale-specific whitespace rules.
    if (
      Array.from(name).length < 1 ||
      Array.from(name).length > 100 ||
      /^[ \t\n\r\f\v]|[ \t\n\r\f\v]$/.test(name) ||
      name.includes('\0')
    ) {
      setError(
        'Season name must contain 1 to 100 characters without leading or trailing whitespace.',
      );
      return;
    }
    const sortOrder = Number(order);
    if (
      !/^-?\d+$/.test(order) ||
      !Number.isInteger(sortOrder) ||
      sortOrder < -2147483648 ||
      sortOrder > 2147483647
    ) {
      setError(
        'Sort order must be an integer between -2147483648 and 2147483647.',
      );
      return;
    }
    pending.current = true;
    setCreating(true);
    onBusyChange(true);
    setError(null);
    try {
      const saved = await apiFetch<Season>('/events/seasons', {
        method: 'POST',
        body: { name, sort_order: sortOrder },
        fallbackError: 'Could not create season',
      });
      if (!mounted.current) return;
      catalog.addSeason(saved);
      onChange(saved.id);
      setShowCreate(false);
      setName('');
      setOrder('0');
    } catch (err) {
      if (mounted.current) {
        setError(
          `${err instanceof Error ? err.message : 'Could not create season'}. Correct the fields and retry, or sign in again as an admin.`,
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        setCreating(false);
        onBusyChange(false);
      }
    }
  };

  const unknownAssignment =
    value !== null && !catalog.seasons.some((season) => season.id === value);

  return (
    <div className="form-group">
      <label htmlFor={id}>Season</label>
      <select
        id={id}
        className="field-input"
        value={value ?? ''}
        required={required}
        disabled={disabled || creating || catalog.loading || !!catalog.error}
        aria-describedby={`${id}-help`}
        onChange={(event) =>
          onChange(event.target.value ? Number(event.target.value) : null)
        }
      >
        <option value="">{required ? 'Select a season' : 'No season'}</option>
        {unknownAssignment && <option value={value}>Season #{value}</option>}
        {catalog.seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
          </option>
        ))}
      </select>
      <p id={`${id}-help`}>
        {required
          ? 'A season is required for the Spectator Archive.'
          : 'Optional for current events.'}{' '}
        Seasons are assigned explicitly, not inferred from event dates.
      </p>
      {catalog.loading && (
        <p role="status">
          Loading seasons… Existing assignments are preserved.
        </p>
      )}
      {catalog.error && (
        <div role="alert">
          <p>
            {catalog.error}. Your assignment is unchanged. Retry loading, or
            sign in again as an admin.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled || creating}
            onClick={() => void catalog.reload()}
          >
            Retry loading seasons
          </button>
        </div>
      )}
      {!catalog.loading && !catalog.error && catalog.seasons.length === 0 && (
        <p>No seasons yet. Create a season below.</p>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled || creating}
        aria-expanded={showCreate}
        onClick={() => setShowCreate(!showCreate)}
      >
        {showCreate ? 'Cancel Season Creation' : '+ Create Season'}
      </button>
      {showCreate && (
        <div style={{ marginTop: '1rem' }}>
          <label htmlFor={`${id}-name`}>Season name</label>
          <input
            id={`${id}-name`}
            className="field-input"
            value={name}
            disabled={disabled || creating}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g., 2026 or 2025–2026"
          />
          <label htmlFor={`${id}-order`}>Sort order</label>
          <input
            id={`${id}-order`}
            className="field-input"
            type="number"
            step="1"
            min="-2147483648"
            max="2147483647"
            value={order}
            disabled={disabled || creating}
            onChange={(event) => setOrder(event.target.value)}
          />
          <p>
            Higher sort orders appear first; ties show the newest season first.
            Names preserve case and internal spacing.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled || creating}
            onClick={() => void createSeason()}
          >
            {creating ? 'Creating Season…' : 'Create Season'}
          </button>
          {creating && <p role="status">Creating season…</p>}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
