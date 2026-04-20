import { useEffect, useState } from 'react';
import type { ScoresheetSchema } from '../../../shared/domain/scoresheetSchema';

/**
 * Load the teams data referenced by `schema.teamsDataSource`, used by the
 * head-to-head bracket flow to resolve team-number → team-name lookups.
 */
export function useTeamsLookup(
  schema: ScoresheetSchema,
  enabled: boolean,
): Array<Record<string, unknown>> {
  const [teamsData, setTeamsData] = useState<Array<Record<string, unknown>>>(
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const teamsConfig = schema.teamsDataSource;
        if (teamsConfig?.type === 'db' && teamsConfig?.eventId) {
          const response = await fetch(`/teams/event/${teamsConfig.eventId}`, {
            credentials: 'include',
          });
          if (!response.ok) {
            console.error('Failed to load teams data from DB');
            return;
          }
          const data = await response.json();
          if (!cancelled) setTeamsData(data);
        }
      } catch (error) {
        console.error('Error loading teams data:', error);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [enabled, schema.teamsDataSource]);

  return teamsData;
}
