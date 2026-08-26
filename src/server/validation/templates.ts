import { z } from 'zod';
import {
  normalizedScoresheetFieldsSchema,
  normalizedScoresheetSchema,
} from '../../shared/scoresheetNormalize';
import {
  coercedPositiveId,
  idParamsSchema,
  optionalNullablePositiveId,
  trimmedNonEmptyString,
} from './primitives';

const nullableString = z.string().nullable();

export const createScoresheetTemplateBodySchema = z
  .object({
    name: trimmedNonEmptyString,
    description: nullableString.optional(),
    accessCode: trimmedNonEmptyString,
    schema: normalizedScoresheetSchema,
    eventId: optionalNullablePositiveId,
  })
  .strict();

export const updateScoresheetTemplateBodySchema =
  createScoresheetTemplateBodySchema;

export const createFieldTemplateBodySchema = z
  .object({
    name: trimmedNonEmptyString,
    description: nullableString.optional(),
    fields: normalizedScoresheetFieldsSchema,
  })
  .strict();

export const updateFieldTemplateBodySchema = createFieldTemplateBodySchema;

export const verifyScoresheetTemplateBodySchema = z
  .object({
    accessCode: trimmedNonEmptyString,
  })
  .strict();

export const adminScoresheetTemplatesQuerySchema = z
  .object({
    eventId: coercedPositiveId.optional(),
  })
  .strict();

export const createScoresheetTemplateRequest = {
  body: createScoresheetTemplateBodySchema,
};

export const updateScoresheetTemplateRequest = {
  params: idParamsSchema,
  body: updateScoresheetTemplateBodySchema,
};

export const scoresheetTemplateIdRequest = {
  params: idParamsSchema,
};

export const verifyScoresheetTemplateRequest = {
  params: idParamsSchema,
  body: verifyScoresheetTemplateBodySchema,
};

export const adminScoresheetTemplatesRequest = {
  query: adminScoresheetTemplatesQuerySchema,
};

export const createFieldTemplateRequest = {
  body: createFieldTemplateBodySchema,
};

export const updateFieldTemplateRequest = {
  params: idParamsSchema,
  body: updateFieldTemplateBodySchema,
};

export const fieldTemplateIdRequest = {
  params: idParamsSchema,
};
