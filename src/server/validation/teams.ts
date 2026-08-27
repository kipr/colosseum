import { z } from './schema';
import {
  coercedPositiveId,
  mergePatch,
  nonEmptyObject,
  positiveId,
  trimmedNonEmptyString,
} from './primitives';

export const TEAM_STATUSES = [
  'registered',
  'checked_in',
  'no_show',
  'withdrawn',
] as const;

export const teamStatusSchema = z.enum(TEAM_STATUSES);

export const createTeamBodySchema = z
  .object({
    event_id: positiveId,
    team_number: positiveId,
    team_name: trimmedNonEmptyString,
    display_name: z.string().trim().min(1).optional(),
    status: teamStatusSchema.optional().default('registered'),
  })
  .strict();

export const teamPatchBodySchema = nonEmptyObject(
  z.object({
    team_number: positiveId.optional(),
    team_name: trimmedNonEmptyString.optional(),
    display_name: z.string().trim().min(1).nullable().optional(),
    status: teamStatusSchema.optional(),
  }),
);

export const teamUpdateSchema = z
  .object({
    team_number: positiveId,
    team_name: trimmedNonEmptyString,
    display_name: z.string().trim().min(1).nullable(),
    status: teamStatusSchema,
  })
  .strict();

export type TeamUpdate = z.infer<typeof teamUpdateSchema>;

export const bulkCheckInBodySchema = z
  .object({
    team_numbers: z.array(positiveId).min(1),
  })
  .strict();

export const teamIdParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const createTeamRequest = { body: createTeamBodySchema };
export const patchTeamRequest = {
  params: teamIdParamsSchema,
  body: teamPatchBodySchema,
};
export const teamIdRequest = { params: teamIdParamsSchema };
export const bulkCheckInRequest = {
  params: z.object({ eventId: coercedPositiveId }).strict(),
  body: bulkCheckInBodySchema,
};

export function teamRowToUpdateCandidate(row: {
  team_number: number;
  team_name: string;
  display_name: string | null;
  status: string;
}): TeamUpdate {
  return {
    team_number: Number(row.team_number),
    team_name: row.team_name,
    display_name: row.display_name,
    status: row.status as TeamUpdate['status'],
  };
}

export function mergeTeamPatch(
  current: TeamUpdate,
  patch: z.infer<typeof teamPatchBodySchema>,
): TeamUpdate {
  return mergePatch(current, patch);
}
