import { describe, expect, it } from 'vitest';
import { canonicalSchema } from '../../helpers/canonicalSchema';
import {
  adminScoresheetTemplatesQuerySchema,
  createFieldTemplateBodySchema,
  createScoresheetTemplateBodySchema,
  updateScoresheetTemplateBodySchema,
  verifyScoresheetTemplateBodySchema,
} from '../../../src/server/validation/templates';
import { SCORESHEET_SCHEMA_VERSION } from '../../../src/shared/scoresheetSchema';

describe('createScoresheetTemplateBodySchema', () => {
  it('normalizes an unversioned schema and trims name and accessCode', () => {
    const result = createScoresheetTemplateBodySchema.safeParse({
      name: '  Sheet  ',
      accessCode: '  code  ',
      schema: { fields: [] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Sheet');
      expect(result.data.accessCode).toBe('code');
      expect(result.data.schema.schemaVersion).toBe(SCORESHEET_SCHEMA_VERSION);
      expect(result.data.schema.fields).toEqual([]);
    }
  });

  it('rejects missing required envelope fields and unknown keys', () => {
    expect(createScoresheetTemplateBodySchema.safeParse({}).success).toBe(
      false,
    );
    expect(
      createScoresheetTemplateBodySchema.safeParse({
        name: 'Sheet',
        accessCode: 'code',
        schema: canonicalSchema(),
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('rejects a schema that is still invalid after normalization', () => {
    expect(
      createScoresheetTemplateBodySchema.safeParse({
        name: 'Sheet',
        accessCode: 'code',
        schema: { mode: 'head-to-head' },
      }).success,
    ).toBe(false);
  });
});

describe('updateScoresheetTemplateBodySchema', () => {
  it('is a full replace of the create envelope', () => {
    expect(
      updateScoresheetTemplateBodySchema.safeParse({
        name: 'Sheet',
        accessCode: 'code',
        schema: canonicalSchema(),
        eventId: 3,
      }).success,
    ).toBe(true);
    expect(
      updateScoresheetTemplateBodySchema.safeParse({
        name: 'Sheet',
      }).success,
    ).toBe(false);
  });
});

describe('createFieldTemplateBodySchema', () => {
  it('accepts canonical fields and rejects non-arrays', () => {
    expect(
      createFieldTemplateBodySchema.safeParse({
        name: 'Pack',
        fields: [{ id: 'score', label: 'Score', type: 'number' }],
      }).success,
    ).toBe(true);
    expect(
      createFieldTemplateBodySchema.safeParse({
        name: 'Pack',
        fields: 'nope',
      }).success,
    ).toBe(false);
  });
});

describe('verify and admin query envelopes', () => {
  it('requires a non-empty accessCode', () => {
    expect(
      verifyScoresheetTemplateBodySchema.safeParse({ accessCode: '  x  ' })
        .success,
    ).toBe(true);
    expect(verifyScoresheetTemplateBodySchema.safeParse({}).success).toBe(
      false,
    );
  });

  it('coerces admin eventId from a query string', () => {
    expect(
      adminScoresheetTemplatesQuerySchema.safeParse({ eventId: '4' }).success,
    ).toBe(true);
    expect(
      adminScoresheetTemplatesQuerySchema.safeParse({ eventId: 'abc' }).success,
    ).toBe(false);
    expect(adminScoresheetTemplatesQuerySchema.safeParse({}).success).toBe(
      true,
    );
  });
});
