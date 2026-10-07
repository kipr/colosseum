import { describe, expect, it } from 'vitest';
import { generateDEBracketTemplates } from '../../../src/server/services/bracketTemplates';
import golden from './__fixtures__/bracketTemplates.golden.json';

/**
 * The bracket templates are seeded with `ON CONFLICT ... DO UPDATE SET
 * play_order` only, so any change to the generated structure would silently
 * diverge from rows already in production databases. This fixture records the
 * exact output (array order, every field, play_order included) and must only
 * change together with a deliberate bracket redesign.
 */
const supportedSizes = [4, 8, 16, 32, 64];

describe('generateDEBracketTemplates golden output', () => {
  it('records exactly the supported bracket sizes', () => {
    expect(Object.keys(golden).map(Number)).toEqual(supportedSizes);
  });

  it.each(supportedSizes)('matches the recorded %i-team bracket', (size) => {
    expect(generateDEBracketTemplates(size)).toStrictEqual(
      golden[String(size) as keyof typeof golden],
    );
  });
});
