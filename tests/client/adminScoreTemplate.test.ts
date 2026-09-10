import { describe, expect, it, vi } from 'vitest';
import {
  findTemplateForScore,
  loadAdminScoreTemplate,
  templateIdsMatch,
} from '../../src/client/utils/adminScoreTemplate';

describe('templateIdsMatch', () => {
  it('matches number and string IDs from Postgres JSON', () => {
    expect(templateIdsMatch(12, '12')).toBe(true);
    expect(templateIdsMatch('12', 12)).toBe(true);
    expect(templateIdsMatch(12, 12)).toBe(true);
  });

  it('does not match distinct IDs or empty values', () => {
    expect(templateIdsMatch(12, 13)).toBe(false);
    expect(templateIdsMatch(12, null)).toBe(false);
    expect(templateIdsMatch('', '12')).toBe(false);
  });
});

describe('findTemplateForScore', () => {
  const templates = [
    { id: 1, name: 'Seeding' },
    { id: 2, name: 'Bracket' },
  ];

  it('finds a template when score.template_id is a string', () => {
    expect(findTemplateForScore(templates, { template_id: '2' })?.name).toBe(
      'Bracket',
    );
  });

  it('falls back to template name when IDs do not match', () => {
    expect(
      findTemplateForScore(templates, {
        template_id: 99,
        template_name: 'Seeding',
      })?.id,
    ).toBe(1);
  });

  it('returns undefined when neither id nor name matches', () => {
    expect(
      findTemplateForScore(templates, {
        template_id: 99,
        template_name: 'Missing',
      }),
    ).toBeUndefined();
  });
});

describe('loadAdminScoreTemplate', () => {
  it('loads the template by id with credentials, not the public judge list', async () => {
    const template = { id: 7, name: 'Seeding', schema: { title: 'Seeding' } };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/scoresheet/templates/7') {
        return {
          ok: true,
          json: async () => template,
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await loadAdminScoreTemplate(
      { template_id: 7, template_name: 'Seeding' },
      fetchImpl,
    );

    expect(result).toEqual(template);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/scoresheet/templates/7', {
      credentials: 'include',
    });
  });

  it('falls back to the admin list and name match when by-id misses', async () => {
    const template = {
      id: 4,
      name: 'Bracket Sheet',
      schema: { title: 'Bracket Sheet' },
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/scoresheet/templates/99') {
        return {
          ok: false,
          json: async () => ({ error: 'Template not found' }),
        };
      }
      if (url === '/scoresheet/templates/admin') {
        return {
          ok: true,
          json: async () => [
            { id: '4', name: 'Bracket Sheet' },
            { id: 8, name: 'Other' },
          ],
        };
      }
      if (url === '/scoresheet/templates/4') {
        return { ok: true, json: async () => template };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await loadAdminScoreTemplate(
      { template_id: 99, template_name: 'Bracket Sheet' },
      fetchImpl,
    );

    expect(result).toEqual(template);
    expect(fetchImpl).toHaveBeenCalledWith('/scoresheet/templates/admin', {
      credentials: 'include',
    });
  });

  it('returns null when the template cannot be resolved', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/scoresheet/templates/99') {
        return { ok: false, json: async () => ({}) };
      }
      if (url === '/scoresheet/templates/admin') {
        return { ok: true, json: async () => [{ id: 1, name: 'Other' }] };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(
      loadAdminScoreTemplate(
        { template_id: 99, template_name: 'Missing' },
        fetchImpl,
      ),
    ).resolves.toBeNull();
  });
});
