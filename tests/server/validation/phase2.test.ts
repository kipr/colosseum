import { describe, expect, it } from 'vitest';
import {
  createTeamBodySchema,
  teamPatchBodySchema,
} from '../../../src/server/validation/teams';
import {
  createQueueItemBodySchema,
  queuePresenceBodySchema,
} from '../../../src/server/validation/queue';
import {
  createSeedingScoreBodySchema,
  seedingScorePatchBodySchema,
} from '../../../src/server/validation/seeding';
import {
  createBracketBodySchema,
  bracketPatchBodySchema,
} from '../../../src/server/validation/brackets';
import {
  createAwardTemplateBodySchema,
  addRecipientsBodySchema,
} from '../../../src/server/validation/awards';
import { postChatMessageBodySchema } from '../../../src/server/validation/chat';
import { generateDoubleSeedingBodySchema } from '../../../src/server/validation/doubleSeeding';

describe('createTeamBodySchema', () => {
  it('requires ids and a trimmed name', () => {
    const result = createTeamBodySchema.safeParse({
      event_id: 1,
      team_number: 10,
      team_name: ' Gearheads ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.team_name).toBe('Gearheads');
      expect(result.data.status).toBe('registered');
    }
  });

  it('rejects unknown keys and non-positive numbers', () => {
    expect(
      createTeamBodySchema.safeParse({
        event_id: 1,
        team_number: 0,
        team_name: 'A',
      }).success,
    ).toBe(false);
    expect(
      createTeamBodySchema.safeParse({
        event_id: 1,
        team_number: 1,
        team_name: 'A',
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe('teamPatchBodySchema', () => {
  it('rejects empty patches and unknown keys', () => {
    expect(teamPatchBodySchema.safeParse({}).success).toBe(false);
    expect(
      teamPatchBodySchema.safeParse({ team_name: 'A', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('createQueueItemBodySchema', () => {
  it('requires type-specific ids', () => {
    expect(
      createQueueItemBodySchema.safeParse({
        event_id: 1,
        queue_type: 'bracket',
        bracket_game_id: 4,
      }).success,
    ).toBe(true);
    expect(
      createQueueItemBodySchema.safeParse({
        event_id: 1,
        queue_type: 'bracket',
      }).success,
    ).toBe(false);
    expect(
      createQueueItemBodySchema.safeParse({
        event_id: 1,
        queue_type: 'seeding',
        seeding_team_id: 2,
        seeding_round: 1,
      }).success,
    ).toBe(true);
  });
});

describe('queuePresenceBodySchema', () => {
  it('requires a boolean present flag without string coercion', () => {
    expect(
      queuePresenceBodySchema.safeParse({ team_id: 1, present: true }).success,
    ).toBe(true);
    expect(
      queuePresenceBodySchema.safeParse({ team_id: 1, present: 'yes' }).success,
    ).toBe(false);
  });
});

describe('seeding score schemas', () => {
  it('creates and patches scores', () => {
    expect(
      createSeedingScoreBodySchema.safeParse({
        team_id: 1,
        round_number: 2,
      }).success,
    ).toBe(true);
    expect(seedingScorePatchBodySchema.safeParse({ score: 100 }).success).toBe(
      true,
    );
    expect(seedingScorePatchBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('bracket schemas', () => {
  it('requires event and name; weight must be in (0, 1]', () => {
    expect(
      createBracketBodySchema.safeParse({ event_id: 1, name: ' Main ' })
        .success,
    ).toBe(true);
    expect(
      createBracketBodySchema.safeParse({
        event_id: 1,
        name: 'Main',
        weight: 0,
      }).success,
    ).toBe(false);
    expect(bracketPatchBodySchema.safeParse({ name: 'Updated' }).success).toBe(
      true,
    );
  });
});

describe('award schemas', () => {
  it('defaults award type and requires recipients', () => {
    const created = createAwardTemplateBodySchema.safeParse({
      name: ' Design ',
    });
    expect(created.success).toBe(true);
    if (created.success) {
      expect(created.data.name).toBe('Design');
      expect(created.data.award_type).toBe('trophy');
    }
    expect(addRecipientsBodySchema.safeParse({ team_id: 1 }).success).toBe(
      true,
    );
    expect(addRecipientsBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('chat and double-seeding schemas', () => {
  it('bounds chat messages and defaults double-seeding rounds', () => {
    expect(
      postChatMessageBodySchema.safeParse({ message: ' Hello ' }).success,
    ).toBe(true);
    expect(
      postChatMessageBodySchema.safeParse({ message: 'x'.repeat(1001) })
        .success,
    ).toBe(false);
    const generated = generateDoubleSeedingBodySchema.safeParse({});
    expect(generated.success).toBe(true);
    if (generated.success) {
      expect(generated.data.rounds).toBe(5);
    }
  });
});
