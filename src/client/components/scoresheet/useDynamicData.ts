import { useEffect, useState } from 'react';
import type { ScoresheetSchema } from '../../../shared/domain/scoresheetSchema';

/**
 * Load `dataSource: { type: 'db' }` lookups for every field in the schema that
 * has one. The result is keyed by `field.id` and shaped as a list of options
 * suitable for the dynamic-select renderer.
 *
 * Skips the `team_number` field when the form is using the queue for seeding,
 * since the queue dropdown already drives that selection.
 */
export function useDynamicData(
  schema: ScoresheetSchema,
  useQueueForSeeding: boolean,
): Record<string, Array<Record<string, unknown>>> {
  const [dynamicData, setDynamicData] = useState<
    Record<string, Array<Record<string, unknown>>>
  >({});

  useEffect(() => {
    let cancelled = false;
    const fieldsWithDataSource = schema.fields.filter(
      (f) =>
        f.dataSource &&
        f.dataSource.type !== 'bracket' &&
        !(useQueueForSeeding && f.id === 'team_number'),
    );

    const load = async () => {
      for (const field of fieldsWithDataSource) {
        try {
          const ds = field.dataSource;
          if (!ds) continue;
          if (ds.type === 'db' && ds.eventId) {
            const response = await fetch(`/teams/event/${ds.eventId}`, {
              credentials: 'include',
            });
            if (!response.ok) {
              console.error(`Failed to load ${field.id} from DB`);
              continue;
            }
            const raw = await response.json();
            const labelField = ds.labelField || 'team_number';
            const valueField = ds.valueField || 'team_number';

            let data = raw.map((t: Record<string, unknown>) => ({
              [labelField]: String(t.team_number),
              [valueField]: String(t.team_number),
              team_name: t.team_name || t.display_name,
              team_id: t.id,
              'Team Number': String(t.team_number),
              'Team Name': t.team_name || t.display_name,
            }));

            data = data.sort(
              (a: Record<string, unknown>, b: Record<string, unknown>) => {
                const aVal = String(a[labelField] || '');
                const bVal = String(b[labelField] || '');
                const aNum = parseFloat(aVal);
                const bNum = parseFloat(bVal);
                if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
                return aVal.localeCompare(bVal, undefined, {
                  numeric: true,
                  sensitivity: 'base',
                });
              },
            );

            if (!cancelled) {
              setDynamicData((prev) => ({ ...prev, [field.id]: data }));
            }
          }
        } catch (error) {
          console.error(`Error loading data for ${field.id}:`, error);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [schema, useQueueForSeeding]);

  return dynamicData;
}
