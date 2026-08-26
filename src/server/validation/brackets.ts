import { z } from 'zod';
import { coercedPositiveId, positiveId } from './primitives';

export const advanceWinnerParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const advanceWinnerBodySchema = z
  .object({
    game_id: positiveId,
    winner_id: positiveId,
  })
  .strict();

export const advanceWinnerRequest = {
  params: advanceWinnerParamsSchema,
  body: advanceWinnerBodySchema,
};
