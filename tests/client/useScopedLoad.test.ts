// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useScopedLoad,
  type ScopedLoad,
  type ScopedLoadOptions,
} from '../../src/client/hooks/useScopedLoad';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Call {
  key: number;
  signal: AbortSignal;
  response: Deferred<string>;
}

type ProbeProps = {
  scopeKey: number | null;
} & Omit<ScopedLoadOptions<string>, 'initial'>;

let root: Root;
let calls: Call[];
let latest: ScopedLoad<string>;
let renders: ScopedLoad<string>[];

function load(key: number, signal: AbortSignal): Promise<string> {
  const response = deferred<string>();
  calls.push({ key, signal, response });
  return response.promise;
}

function Probe({ scopeKey, ...options }: ProbeProps) {
  latest = useScopedLoad(scopeKey, load, { initial: 'initial', ...options });
  renders.push(latest);
  return null;
}

async function render(props: ProbeProps) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

async function respond(call: Call, value: string) {
  await act(async () => {
    call.response.resolve(value);
  });
}

beforeEach(() => {
  calls = [];
  renders = [];
  root = createRoot(document.createElement('div'));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe('useScopedLoad', () => {
  it('loads the key and reports loading until the response arrives', async () => {
    await render({ scopeKey: 1 });
    expect(calls.map((c) => c.key)).toEqual([1]);
    expect(latest).toMatchObject({ data: 'initial', loading: true });

    await respond(calls[0], 'event 1');
    expect(latest).toMatchObject({ data: 'event 1', loading: false });
  });

  it('loads nothing for a null key', async () => {
    await render({ scopeKey: null });
    expect(calls).toHaveLength(0);
    expect(latest).toMatchObject({ data: 'initial', loading: false });
  });

  it('treats a NaN key (an unparsable route param) as no key', async () => {
    await render({ scopeKey: Number('abc') });
    expect(calls).toHaveLength(0);
    expect(latest).toMatchObject({ data: 'initial', loading: false });
  });

  it('drops a slow response for a previous key', async () => {
    await render({ scopeKey: 1 });
    await render({ scopeKey: 2 });
    expect(calls.map((c) => c.key)).toEqual([1, 2]);
    expect(calls[0].signal.aborted).toBe(true);

    await respond(calls[1], 'event 2');
    await respond(calls[0], 'event 1');
    expect(latest).toMatchObject({ data: 'event 2', loading: false });
  });

  it('returns the initial data as soon as the key changes', async () => {
    await render({ scopeKey: 1 });
    await respond(calls[0], 'event 1');

    await render({ scopeKey: 2 });
    expect(latest).toMatchObject({ data: 'initial', loading: true });

    await render({ scopeKey: null });
    expect(latest).toMatchObject({ data: 'initial', loading: false });
  });

  it('defers the load until enabled and keeps it across toggles', async () => {
    await render({ scopeKey: 1, enabled: false });
    expect(calls).toHaveLength(0);
    expect(latest.loading).toBe(false);

    await render({ scopeKey: 1, enabled: true });
    await respond(calls[0], 'event 1');
    await render({ scopeKey: 1, enabled: false });
    await render({ scopeKey: 1, enabled: true });
    expect(calls).toHaveLength(1);
    expect(latest.data).toBe('event 1');
  });

  it('lets a load in flight finish while disabled', async () => {
    await render({ scopeKey: 1, enabled: true });
    await render({ scopeKey: 1, enabled: false });
    expect(calls[0].signal.aborted).toBe(false);

    await render({ scopeKey: 1, enabled: true });
    expect(calls).toHaveLength(1);
    expect(latest.loading).toBe(true);

    await render({ scopeKey: 1, enabled: false });
    await respond(calls[0], 'event 1');
    await render({ scopeKey: 1, enabled: true });
    expect(calls).toHaveLength(1);
    expect(latest).toMatchObject({ data: 'event 1', loading: false });
  });

  it('retries a failed load on re-enable without an empty frame', async () => {
    await render({ scopeKey: 1, enabled: true, onError: () => {} });
    await render({ scopeKey: 1, enabled: false, onError: () => {} });
    await act(async () => {
      calls[0].response.reject(new Error('boom'));
    });

    renders = [];
    await render({ scopeKey: 1, enabled: true, onError: () => {} });
    expect(calls).toHaveLength(2);
    expect(renders.every((r) => r.loading)).toBe(true);
    await respond(calls[1], 'event 1');
    expect(latest.data).toBe('event 1');
  });

  it('keeps only the latest reload and resolves it once settled', async () => {
    await render({ scopeKey: 1 });
    await respond(calls[0], 'v1');

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = latest.reload();
      second = latest.reload();
    });
    expect(latest).toMatchObject({ data: 'v1', loading: true });
    expect(calls[1].signal.aborted).toBe(true);

    await respond(calls[2], 'v3');
    await respond(calls[1], 'v2');
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(latest).toMatchObject({ data: 'v3', loading: false });
  });

  it('reports the latest failure and keeps the loaded data', async () => {
    const onError = vi.fn();
    await render({ scopeKey: 1, onError });
    await respond(calls[0], 'v1');

    await act(async () => {
      void latest.reload();
    });
    await act(async () => {
      calls[1].response.reject(new Error('boom'));
    });
    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    expect(latest).toMatchObject({ data: 'v1', loading: false });
  });

  it('ignores the failure of a superseded request', async () => {
    const onError = vi.fn();
    await render({ scopeKey: 1, onError });
    await render({ scopeKey: 2, onError });
    await act(async () => {
      calls[0].response.reject(new Error('aborted'));
    });
    expect(onError).not.toHaveBeenCalled();
    expect(latest.loading).toBe(true);
  });

  it('does not retry a failed load on its own', async () => {
    await render({ scopeKey: 1, onError: () => {} });
    await act(async () => {
      calls[0].response.reject(new Error('boom'));
    });
    await render({ scopeKey: 1, onError: () => {} });
    expect(calls).toHaveLength(1);
    expect(latest).toMatchObject({ data: 'initial', loading: false });
  });

  it('updates the current key data in place', async () => {
    await render({ scopeKey: 1 });
    await respond(calls[0], 'v1');
    await act(async () => {
      latest.setData((prev) => `${prev}+local`);
    });
    expect(latest.data).toBe('v1+local');
  });
});
