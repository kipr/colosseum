import { z } from './schema';
import { coercedPositiveId } from './primitives';

export const generateDoubleSeedingBodySchema = z
  .object({
    rounds: z.number().int().min(0).optional().default(5),
  })
  .strict();

export const doubleSeedingEventParamsSchema = z
  .object({
    eventId: coercedPositiveId,
  })
  .strict();

export const doubleSeedingRoundParamsSchema = z
  .object({
    eventId: coercedPositiveId,
    roundNumber: coercedPositiveId,
  })
  .strict();

export const generateDoubleSeedingRequest = {
  params: doubleSeedingEventParamsSchema,
  body: generateDoubleSeedingBodySchema,
};

export const deleteDoubleSeedingMatchesRequest = {
  params: doubleSeedingEventParamsSchema,
};

export const deleteDoubleSeedingRoundRequest = {
  params: doubleSeedingRoundParamsSchema,
};
