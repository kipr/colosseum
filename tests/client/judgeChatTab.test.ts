import React from 'react';
import { describe, expect, it, vi } from 'vitest';

type TestEvent = {
  id: number;
  name: string;
};

const selectedEventRef = vi.hoisted(() => ({
  current: null as TestEvent | null,
}));

vi.mock('../../src/client/contexts/EventContext', () => ({
  useEvent: () => ({
    selectedEvent: selectedEventRef.current,
  }),
}));

vi.mock('../../src/client/contexts/JudgeChatContext', () => ({
  JudgeChatProvider: ({ children }: { children: React.ReactNode }) => children,
  useJudgeChat: vi.fn(),
}));

import JudgeChatTab from '../../src/client/components/admin/JudgeChatTab';

describe('JudgeChatTab', () => {
  it('keys the judge chat provider by selected event id', () => {
    selectedEventRef.current = { id: 1, name: 'Event A' };
    const eventAElement = JudgeChatTab() as React.ReactElement<{
      eventId: number;
      mode: string;
    }>;

    selectedEventRef.current = { id: 2, name: 'Event B' };
    const eventBElement = JudgeChatTab() as React.ReactElement<{
      eventId: number;
      mode: string;
    }>;

    expect(eventAElement.props.eventId).toBe(1);
    expect(eventAElement.key).toBe('1');
    expect(eventBElement.props.eventId).toBe(2);
    expect(eventBElement.key).toBe('2');
  });
});
