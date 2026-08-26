import { z } from 'zod';
import { DEFAULT_AWARD_TYPE } from '../../shared/awards';
import {
  coercedPositiveId,
  mergePatch,
  nonEmptyObject,
  optionalNullablePositiveId,
  positiveId,
  trimmedNonEmptyString,
} from './primitives';

export const awardTypeSchema = z.enum(['certificate', 'trophy']);

const nullableString = z.string().nullable();

export const createAwardTemplateBodySchema = z
  .object({
    name: trimmedNonEmptyString,
    description: nullableString.optional(),
    award_type: awardTypeSchema.optional().default(DEFAULT_AWARD_TYPE),
  })
  .strict();

export const awardTemplatePatchBodySchema = nonEmptyObject(
  z.object({
    name: trimmedNonEmptyString.optional(),
    description: nullableString.optional(),
    award_type: awardTypeSchema.optional(),
  }),
);

export const awardTemplateUpdateSchema = z
  .object({
    name: trimmedNonEmptyString,
    description: z.string().nullable(),
    award_type: awardTypeSchema,
  })
  .strict();

export type AwardTemplateUpdate = z.infer<typeof awardTemplateUpdateSchema>;

export const createEventAwardBodySchema = z
  .object({
    template_award_id: positiveId.optional(),
    name: z.string().trim().min(1).optional(),
    description: nullableString.optional(),
    sort_order: z.number().int().optional(),
    award_type: awardTypeSchema.optional(),
  })
  .strict()
  .refine((value) => value.template_award_id !== undefined || value.name, {
    message: 'Name is required',
    path: ['name'],
  });

export const eventAwardPatchBodySchema = nonEmptyObject(
  z.object({
    name: trimmedNonEmptyString.optional(),
    description: nullableString.optional(),
    sort_order: z.number().int().optional(),
    award_type: awardTypeSchema.optional(),
  }),
);

export const eventAwardUpdateSchema = z
  .object({
    name: trimmedNonEmptyString,
    description: z.string().nullable(),
    sort_order: z.number().int(),
    award_type: awardTypeSchema,
  })
  .strict();

export type EventAwardUpdate = z.infer<typeof eventAwardUpdateSchema>;

export const addRecipientsBodySchema = z
  .object({
    team_id: positiveId.optional(),
    team_ids: z.array(positiveId).min(1).optional(),
  })
  .strict()
  .refine((value) => value.team_id !== undefined || value.team_ids, {
    message: 'team_id or team_ids is required',
  });

export const addIndividualRecipientBodySchema = z
  .object({
    name: trimmedNonEmptyString.max(200),
    team_id: optionalNullablePositiveId,
  })
  .strict();

export const awardIdParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const eventAwardRecipientParamsSchema = z
  .object({
    awardId: coercedPositiveId,
    teamId: coercedPositiveId,
  })
  .strict();

export const eventAwardIndividualRecipientParamsSchema = z
  .object({
    awardId: coercedPositiveId,
    recipientId: coercedPositiveId,
  })
  .strict();

export const createAwardTemplateRequest = {
  body: createAwardTemplateBodySchema,
};
export const patchAwardTemplateRequest = {
  params: awardIdParamsSchema,
  body: awardTemplatePatchBodySchema,
};
export const awardIdRequest = { params: awardIdParamsSchema };
export const createEventAwardRequest = {
  params: z.object({ eventId: coercedPositiveId }).strict(),
  body: createEventAwardBodySchema,
};
export const patchEventAwardRequest = {
  params: awardIdParamsSchema,
  body: eventAwardPatchBodySchema,
};
export const addRecipientsRequest = {
  params: awardIdParamsSchema,
  body: addRecipientsBodySchema,
};
export const addIndividualRecipientRequest = {
  params: awardIdParamsSchema,
  body: addIndividualRecipientBodySchema,
};
export const eventAwardRecipientRequest = {
  params: eventAwardRecipientParamsSchema,
};
export const eventAwardIndividualRecipientRequest = {
  params: eventAwardIndividualRecipientParamsSchema,
};

export function awardTemplateRowToUpdateCandidate(row: {
  name: string;
  description: string | null;
  award_type: string;
}): AwardTemplateUpdate {
  return {
    name: row.name,
    description: row.description,
    award_type: row.award_type as AwardTemplateUpdate['award_type'],
  };
}

export function mergeAwardTemplatePatch(
  current: AwardTemplateUpdate,
  patch: z.infer<typeof awardTemplatePatchBodySchema>,
): AwardTemplateUpdate {
  return mergePatch(current, patch);
}

export function eventAwardRowToUpdateCandidate(row: {
  name: string;
  description: string | null;
  sort_order: number;
  award_type: string;
}): EventAwardUpdate {
  return {
    name: row.name,
    description: row.description,
    sort_order: Number(row.sort_order),
    award_type: row.award_type as EventAwardUpdate['award_type'],
  };
}

export function mergeEventAwardPatch(
  current: EventAwardUpdate,
  patch: z.infer<typeof eventAwardPatchBodySchema>,
): EventAwardUpdate {
  return mergePatch(current, patch);
}
