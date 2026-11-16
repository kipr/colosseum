// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventsTab from '../../src/client/components/admin/EventsTab';
import { ApiError, type ApiFetchOptions } from '../../src/client/utils/api';
import type { Event, Season } from '../../src/client/utils/eventStatus';

const mocks = vi.hoisted(() => ({
  useEvent: vi.fn(),
  apiFetch: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    ToastContainer: null,
  },
}));

vi.mock('../../src/client/contexts/EventContext', () => ({
  useEvent: mocks.useEvent,
}));
vi.mock('../../src/client/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/utils/api')>()),
  apiFetch: mocks.apiFetch,
}));
vi.mock('../../src/client/components/Toast', () => ({
  useToast: () => mocks.toast,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makeEvent(id: number, overrides: Partial<Event> = {}): Event {
  return {
    id,
    name: `Event ${id}`,
    description: `Description ${id}`,
    event_date: '2026-05-01',
    location: `Location ${id}`,
    status: 'complete',
    spectator_listing: 'current',
    season_id: null,
    seeding_rounds: 3,
    double_seeding_rounds: 0,
    min_rest_minutes: 3,
    score_accept_mode: 'manual',
    spectator_results_released: false,
    created_by: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const seasons: Season[] = [
  { id: 701, name: '2026–2027', sort_order: 20 },
  { id: 509, name: '2025–2026', sort_order: 10 },
];
const MOVE = 'Move to Spectator Archive';
const RETURN = 'Return to Current Events';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Request = {
  path: string;
  options: ApiFetchOptions;
  response: ReturnType<typeof deferred<unknown>>;
};
const context = {
  events: [] as Event[],
  selectedEvent: null as Event | null,
  loading: false,
  error: null,
  refreshEvents:
    vi.fn<(options?: { background?: boolean }) => Promise<Event[]>>(),
  beginEventMutation: vi.fn<() => (event: Event) => void>(),
  reconcileEvent: vi.fn<(event: Event) => void>(),
  setSelectedEvent: vi.fn<(event: Event | null) => void>(),
};
let container: HTMLDivElement;
let root: Root | null;
let requests: Request[];
const originalDialogMethods = {
  showModal: Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    'showModal',
  ),
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close'),
};

function text(element: Element) {
  return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function button(name: string, scope: ParentNode = container) {
  const found = Array.from(scope.querySelectorAll('button')).find(
    (element) => (element.getAttribute('aria-label') ?? text(element)) === name,
  );
  expect(found, `Button ${JSON.stringify(name)} should exist`).toBeDefined();
  return found!;
}

function field<T extends HTMLInputElement | HTMLSelectElement>(
  label: string,
  scope: ParentNode = container,
): T {
  const found = Array.from(scope.querySelectorAll('label')).find(
    (element) => text(element).replace(/\s*\*$/, '') === label,
  );
  expect(found, `Label ${JSON.stringify(label)} should exist`).toBeDefined();
  const control = document.getElementById(found!.htmlFor);
  expect(control, `${label} must label a real control`).not.toBeNull();
  return control as T;
}

function dialog() {
  const found = container.querySelector<HTMLDialogElement>('dialog[open]');
  expect(found, 'A real open Modal dialog should exist').not.toBeNull();
  return found!;
}

function seasonField(id: 'event-season' | 'archive-season') {
  const select = field<HTMLSelectElement>('Season', dialog());
  expect(select.id).toBe(id);
  return select;
}

function alertText(scope: ParentNode = container) {
  const alerts = Array.from(scope.querySelectorAll('[role="alert"]'));
  expect(alerts.length, 'Errors must be announced inline').toBeGreaterThan(0);
  return alerts.map(text).join(' ');
}

function matchingRequests(path: string, method = 'GET') {
  return requests.filter(
    (request) =>
      request.path === path && (request.options.method ?? 'GET') === method,
  );
}

function request(path: string, method = 'GET', index = 0) {
  const found = matchingRequests(path, method)[index];
  expect(found, `${method} ${path} request #${index + 1}`).toBeDefined();
  return found!;
}

function mutations() {
  return requests.filter(
    (request) => request.options.method && request.options.method !== 'GET',
  );
}

function expectPersisted(saved: Event) {
  expect(context.beginEventMutation).toHaveBeenCalledTimes(1);
  expect(context.reconcileEvent).toHaveBeenCalledExactlyOnceWith(saved);
  expect(context.refreshEvents).toHaveBeenCalledExactlyOnceWith({
    background: true,
  });
  expect(context.reconcileEvent.mock.invocationCallOrder[0]).toBeLessThan(
    context.refreshEvents.mock.invocationCallOrder[0],
  );
}

async function render() {
  await act(async () => {
    root!.render(createElement(MemoryRouter, null, createElement(EventsTab)));
  });
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function change(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function respond(pending: Request, value: unknown) {
  await act(async () => pending.response.resolve(value));
}

async function fail(pending: Request, error: Error) {
  await act(async () => pending.response.reject(error));
}

async function mount(event: Event | null = makeEvent(31), catalog = seasons) {
  context.events = event ? [event] : [];
  context.selectedEvent = event;
  await render();
  await respond(request('/events/seasons'), catalog);
}

async function edit() {
  await click(button('Edit'));
  return dialog();
}

async function openPlacement(label = MOVE) {
  await click(button(label));
  const modal = dialog();
  const heading = modal.querySelector('h1, h2, h3, h4, h5, h6');
  expect(heading && text(heading)).toBe(label);
  expect(modal.getAttribute('aria-labelledby')).toBe(heading!.id);
  expect(modal.getAttribute('aria-modal')).toBe('true');
  return modal;
}

async function submitEvent() {
  const form = dialog().querySelector('form');
  expect(form).not.toBeNull();
  await act(async () => {
    form!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
  });
}

async function dismissBackdrop(modal: HTMLDialogElement) {
  await act(async () => {
    // jsdom has no PointerEvent constructor; React only needs these event fields.
    modal.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });
}

async function escape(modal: HTMLDialogElement) {
  await act(async () => {
    modal.dispatchEvent(new window.Event('cancel', { cancelable: true }));
  });
}

async function beginSeasonCreation(scope = dialog()) {
  await click(button('+ Create Season', scope));
  return {
    name: field<HTMLInputElement>('Season name', scope),
    order: field<HTMLInputElement>('Sort order', scope),
    create: button('Create Season', scope),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requests = [];
  context.events = [];
  context.selectedEvent = null;
  mocks.useEvent.mockImplementation(() => context);
  mocks.apiFetch.mockImplementation(
    (path: string, options: ApiFetchOptions = {}) => {
      const pending = { path, options, response: deferred<unknown>() };
      requests.push(pending);
      return pending.response.promise;
    },
  );
  context.refreshEvents.mockImplementation(async () => context.events);
  context.beginEventMutation.mockImplementation(() => context.reconcileEvent);
  context.reconcileEvent.mockImplementation((saved) => {
    context.events = context.events.some((event) => event.id === saved.id)
      ? context.events.map((event) => (event.id === saved.id ? saved : event))
      : [...context.events, saved];
    if (context.selectedEvent?.id === saved.id) context.selectedEvent = saved;
  });
  context.setSelectedEvent.mockImplementation((event) => {
    context.selectedEvent = event;
  });
  // Keep the real Modal's cancel, backdrop, closeDisabled and labeling behavior.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        if (!this.open) return;
        this.open = false;
        queueMicrotask(() => this.dispatchEvent(new window.Event('close')));
      },
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container.remove();
  for (const name of ['showModal', 'close'] as const) {
    const descriptor = originalDialogMethods[name];
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  vi.restoreAllMocks();
});

describe('EventsTab season catalog and event form', () => {
  it('loads the global season catalog on mount, even without a selected event', async () => {
    await render();
    expect(requests.map(({ path }) => path)).toEqual(['/events/seasons']);
    await click(button('+ Create New Event'));
    const select = seasonField('event-season');
    expect(select.value).toBe('');
    expect(select.disabled).toBe(true);
    await respond(request('/events/seasons'), seasons);
    expect(select.disabled).toBe(false);
    expect(
      Array.from(select.options)
        .filter((option) => option.value)
        .map((option) => [option.value, text(option)]),
    ).toEqual(seasons.map((season) => [String(season.id), season.name]));
    expect(mutations()).toEqual([]);
  });

  it.each(['pending', 'failed', 'missing'] as const)(
    'preserves an unknown assigned season while the catalog is %s and omits unchanged season on save',
    async (state) => {
      const existing = makeEvent(31, { season_id: 811 });
      context.events = [existing];
      context.selectedEvent = existing;
      await render();
      await edit();
      const select = seasonField('event-season');
      expect(select.value).toBe('811');
      expect(text(select.selectedOptions[0])).toBe('Season #811');
      if (state === 'failed') {
        await fail(
          request('/events/seasons'),
          new ApiError('Catalog unavailable', 500, null),
        );
        expect(alertText()).toContain('Catalog unavailable');
        expect(button('Retry loading seasons')).toBeDefined();
      } else if (state === 'missing') {
        await respond(request('/events/seasons'), seasons);
      }
      expect(select.value).toBe('811');
      expect(select.disabled).toBe(state !== 'missing');
      const save = dialog().querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      expect(save.disabled).toBe(false);
      await change(
        field<HTMLInputElement>('Event Name', dialog()),
        'Renamed event',
      );
      await submitEvent();
      const patch = request('/events/31', 'PATCH');
      expect(patch.options.body).toMatchObject({ name: 'Renamed event' });
      expect(patch.options.body).not.toHaveProperty('season_id');
      expect(patch.options.body).not.toHaveProperty('spectator_listing');
      await respond(patch, { ...existing, name: 'Server canonical name' });
      expect(container.querySelector('dialog')).toBeNull();
      expect(context.reconcileEvent).toHaveBeenCalledWith({
        ...existing,
        name: 'Server canonical name',
      });
      expect(context.refreshEvents).toHaveBeenCalledTimes(1);
    },
  );

  it('retries a failed catalog without resetting the assigned season', async () => {
    context.selectedEvent = makeEvent(31, { season_id: 701 });
    context.events = [context.selectedEvent];
    await render();
    await edit();
    await fail(
      request('/events/seasons'),
      new ApiError('Please sign in again', 401, null),
    );
    expect(alertText()).toContain('Please sign in again');
    expect(seasonField('event-season').value).toBe('701');
    await click(button('Retry loading seasons'));
    expect(seasonField('event-season').disabled).toBe(true);
    expect(seasonField('event-season').value).toBe('701');
    await respond(request('/events/seasons', 'GET', 1), seasons);
    expect(seasonField('event-season').disabled).toBe(false);
    expect(text(seasonField('event-season').selectedOptions[0])).toBe(
      seasons[0].name,
    );
    expect(mutations()).toEqual([]);
  });

  it('does not apply a delayed catalog response to a previous event form', async () => {
    const first = makeEvent(31, { season_id: 701 });
    const second = makeEvent(47, { season_id: 509 });
    context.events = [first, second];
    context.selectedEvent = first;
    await render();
    await click(button('Edit', container.querySelector('.card')!));
    await click(button('Cancel', dialog()));
    context.selectedEvent = second;
    await render();
    await click(button('Edit', container.querySelector('.card')!));
    await change(
      field<HTMLInputElement>('Event Name', dialog()),
      'Unsaved second name',
    );
    await respond(request('/events/seasons'), seasons);
    expect(field<HTMLInputElement>('Event Name', dialog()).value).toBe(
      'Unsaved second name',
    );
    expect(seasonField('event-season').value).toBe('509');
    await submitEvent();
    expect(request('/events/47', 'PATCH').options.body).not.toHaveProperty(
      'season_id',
    );
    expect(matchingRequests('/events/31', 'PATCH')).toEqual([]);
  });

  it.each([
    ['changed', '509', 509],
    ['explicitly cleared', '', null],
    ['changed and restored', '701', undefined],
  ] as const)(
    'sends season_id only when %s in an edit',
    async (_label, value, expected) => {
      await mount(makeEvent(31, { season_id: 701 }));
      await edit();
      await change(seasonField('event-season'), '509');
      await change(seasonField('event-season'), value);
      await submitEvent();
      const body = request('/events/31', 'PATCH').options.body;
      if (expected === undefined) expect(body).not.toHaveProperty('season_id');
      else expect(body).toHaveProperty('season_id', expected);
    },
  );

  it('starts a new event with no season instead of inheriting the selected event season', async () => {
    await mount(makeEvent(31, { season_id: 701 }));
    await click(button('+ Create New Event'));
    expect(seasonField('event-season').value).toBe('');
    await change(
      field<HTMLInputElement>('Event Name', dialog()),
      'New current event',
    );
    await submitEvent();
    const body = request('/events', 'POST').options.body as Record<
      string,
      unknown
    >;
    expect(body.season_id ?? null).toBeNull();
    expect(body).not.toHaveProperty('spectator_listing', 'archive');
    expect(matchingRequests('/events/31', 'PATCH')).toEqual([]);
  });

  it('waits for a created event in the confirmed cache before selecting it', async () => {
    const original = makeEvent(31);
    await mount(original);
    context.beginEventMutation.mockReturnValueOnce(vi.fn());
    await click(button('+ Create New Event'));
    await change(field<HTMLInputElement>('Event Name', dialog()), 'New event');
    await submitEvent();
    const created = makeEvent(913, { name: 'New event' });
    await respond(request('/events', 'POST'), created);
    expect(container.querySelector('dialog')).toBeNull();
    expect(context.setSelectedEvent).not.toHaveBeenCalled();
    expect(context.selectedEvent).toEqual(original);

    const confirmed = { ...created, name: 'Latest confirmed name' };
    context.events = [original, confirmed];
    await render();
    expect(context.setSelectedEvent).toHaveBeenCalledExactlyOnceWith(confirmed);
    expect(context.selectedEvent).toEqual(confirmed);
  });

  it.each([
    ['edit', 'success'],
    ['edit', 'failure'],
    ['create', 'success'],
    ['create', 'failure'],
  ])(
    'handles a pending form %s %s after unmount without stale UI callbacks',
    async (operation, result) => {
      const original = makeEvent(31, { season_id: 701 });
      const other = makeEvent(47, { season_id: 509 });
      await mount(original);
      if (operation === 'edit') await edit();
      else await click(button('+ Create New Event'));
      await change(
        field<HTMLInputElement>('Event Name', dialog()),
        'Submitted event name',
      );
      await change(seasonField('event-season'), '509');
      await submitEvent();
      const pending =
        operation === 'edit'
          ? request('/events/31', 'PATCH')
          : request('/events', 'POST');
      expect(pending.options.body).toMatchObject({
        name: 'Submitted event name',
        season_id: 509,
      });
      expect(context.beginEventMutation).toHaveBeenCalledTimes(1);
      expect(context.reconcileEvent).not.toHaveBeenCalled();
      await act(async () => root!.unmount());
      root = null;
      // The provider remains alive and may select another event after leaving this UI.
      context.events = [original, other];
      context.selectedEvent = other;
      const saved = makeEvent(operation === 'edit' ? original.id : 913, {
        name: 'Server canonical event name',
        season_id: 701,
        location: 'Server saved location',
        updated_at: '2026-06-01T12:00:00Z',
      });
      if (result === 'success') {
        await respond(pending, saved);
        expectPersisted(saved);
        expect(context.events).toEqual(
          operation === 'edit' ? [saved, other] : [original, other, saved],
        );
      } else {
        await fail(pending, new TypeError('Late form network failure'));
        expect(context.reconcileEvent).not.toHaveBeenCalled();
        expect(context.refreshEvents).not.toHaveBeenCalled();
        expect(context.events).toEqual([original, other]);
      }
      expect(context.selectedEvent).toEqual(other);
      expect(context.setSelectedEvent).not.toHaveBeenCalled();
      expect(mocks.toast.success).not.toHaveBeenCalled();
      expect(mocks.toast.error).not.toHaveBeenCalled();
      expect(container.querySelector('dialog')).toBeNull();
    },
  );

  it('requires a season when editing an archived placement but still permits further edits', async () => {
    await mount(
      makeEvent(31, { spectator_listing: 'archive', season_id: 701 }),
    );
    await edit();
    expect(seasonField('event-season').value).toBe('701');
    await change(seasonField('event-season'), '');
    await submitEvent();
    expect(mutations()).toEqual([]);
    expect(alertText(dialog())).toMatch(/season/i);
    await change(seasonField('event-season'), '509');
    await submitEvent();
    expect(request('/events/31', 'PATCH').options.body).toHaveProperty(
      'season_id',
      509,
    );
    expect(request('/events/31', 'PATCH').options.body).not.toHaveProperty(
      'status',
    );
  });
});

describe('EventsTab season creation', () => {
  it.each([
    ['empty name', '', '0'],
    ['whitespace only', '   ', '0'],
    ['leading whitespace', ' 2027', '0'],
    ['trailing whitespace', '2027 ', '0'],
    ['over 100 code points', '🤖'.repeat(101), '0'],
    ['fractional order', '2027', '1.5'],
    ['order below int32', '2027', '-2147483649'],
    ['order above int32', '2027', '2147483648'],
  ])(
    'rejects %s locally without silently normalizing it',
    async (_label, name, order) => {
      await mount(null, []);
      await click(button('+ Create New Event'));
      const fields = await beginSeasonCreation();
      await change(fields.name, name);
      await change(fields.order, order);
      await click(fields.create);
      expect(matchingRequests('/events/seasons', 'POST')).toEqual([]);
      expect(alertText(dialog())).toMatch(
        /name|season|sort|order|integer|100|whitespace/i,
      );
      expect(fields.name.value).toBe(name);
      expect(fields.order.value).toBe(order);
    },
  );

  it.each([
    ['100 code points and minimum int32', '🤖'.repeat(100), '-2147483648'],
    [
      'verbatim markup-like name and maximum int32',
      '2027  /  <b>Finals</b>',
      '2147483647',
    ],
  ])('accepts %s and selects the saved ID', async (_label, name, order) => {
    await mount(null, []);
    await click(button('+ Create New Event'));
    const fields = await beginSeasonCreation();
    await change(fields.name, name);
    await change(fields.order, order);
    await click(fields.create);
    const create = request('/events/seasons', 'POST');
    expect(create.options.body).toEqual({ name, sort_order: Number(order) });
    const saved = { id: 913, name, sort_order: Number(order) };
    await respond(create, saved);
    expect(seasonField('event-season').value).toBe('913');
    expect(text(seasonField('event-season').selectedOptions[0])).toBe(
      name.replace(/\s+/g, ' '),
    );
    expect(dialog().querySelector('b')).toBeNull();
    await change(field<HTMLInputElement>('Event Name', dialog()), 'New event');
    await submitEvent();
    expect(request('/events', 'POST').options.body).toHaveProperty(
      'season_id',
      saved.id,
    );
  });

  it.each([400, 409])(
    'preserves season inputs and shows an inline server %s error, then retries',
    async (status) => {
      await mount(null);
      await click(button('+ Create New Event'));
      await change(seasonField('event-season'), '509');
      const fields = await beginSeasonCreation();
      await change(fields.name, '2027–2028');
      await change(fields.order, '-12');
      await click(fields.create);
      const message =
        status === 409
          ? 'A season with this name already exists'
          : 'Invalid season name';
      await fail(
        request('/events/seasons', 'POST'),
        new ApiError(message, status, { error: message }),
      );
      expect(alertText(dialog())).toContain(message);
      expect(fields.name.value).toBe('2027–2028');
      expect(fields.order.value).toBe('-12');
      expect(mocks.toast.success).not.toHaveBeenCalled();
      expect(seasonField('event-season').value).toBe('509');
      await change(fields.name, '2028–2029');
      await click(button('Create Season', dialog()));
      expect(request('/events/seasons', 'POST', 1).options.body).toEqual({
        name: '2028–2029',
        sort_order: -12,
      });
      await respond(request('/events/seasons', 'POST', 1), {
        id: 913,
        name: '2028–2029',
        sort_order: -12,
      });
      expect(seasonField('event-season').value).toBe('913');
    },
  );
});

describe('EventsTab spectator placement dialog', () => {
  it('retains an unknown assigned season through a delayed/failed catalog and a retry', async () => {
    context.selectedEvent = makeEvent(31, { season_id: 811 });
    context.events = [context.selectedEvent];
    await render();
    await openPlacement();
    const select = seasonField('archive-season');
    expect(select.disabled).toBe(true);
    expect(select.value).toBe('811');
    expect(text(select.selectedOptions[0])).toBe('Season #811');
    await fail(
      request('/events/seasons'),
      new TypeError('Catalog network failure'),
    );
    expect(alertText(dialog())).toContain('Catalog network failure');
    expect(select.disabled).toBe(true);
    expect(select.value).toBe('811');
    await click(button('Retry loading seasons', dialog()));
    await respond(request('/events/seasons', 'GET', 1), seasons);
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('811');
    await click(button(MOVE, dialog()));
    expect(request('/events/31', 'PATCH').options.body).toEqual({
      spectator_listing: 'archive',
      season_id: 811,
    });
  });

  it('uses the actual event identity, explains public visibility, and requires a season', async () => {
    const event = makeEvent(31, {
      name: 'Finals <img src=x onerror="alert(1)">',
    });
    await mount(event);
    const modal = await openPlacement();
    expect(text(modal)).toContain(event.name);
    expect(modal.querySelector('img')).toBeNull();
    expect(text(modal)).toMatch(/public|spectator.*view/i);
    expect(seasonField('archive-season').value).toBe('');
    await click(button(MOVE, modal));
    expect(mutations()).toEqual([]);
    expect(modal.open).toBe(true);
    await change(seasonField('archive-season'), '509');
    await click(button(MOVE, modal));
    expect(request('/events/31', 'PATCH').options.body).toEqual({
      spectator_listing: 'archive',
      season_id: 509,
    });
  });

  it.each(['Cancel', 'Escape', 'backdrop'])(
    '%s closes without mutations, and reopening for another event does not reuse its season',
    async (method) => {
      const first = makeEvent(31, { season_id: 701 });
      const second = makeEvent(47);
      await mount(first);
      const modal = await openPlacement();
      await change(seasonField('archive-season'), '509');
      if (method === 'Cancel') await click(button('Cancel', modal));
      else if (method === 'Escape') await escape(modal);
      else await dismissBackdrop(modal);
      expect(container.querySelector('dialog')).toBeNull();
      expect(mutations()).toEqual([]);
      expect(context.refreshEvents).not.toHaveBeenCalled();
      expect(context.reconcileEvent).not.toHaveBeenCalled();
      context.events = [first, second];
      context.selectedEvent = second;
      await render();
      const reopened = await openPlacement();
      expect(text(reopened)).toContain(second.name);
      expect(text(reopened)).not.toContain(first.name);
      expect(seasonField('archive-season').value).toBe('');
    },
  );

  it.each([400, 401, 403, 500, 'network'] as const)(
    'keeps confirmed placement and chosen season after a %s failure and retries the same assignment',
    async (failure) => {
      const original = makeEvent(31, { spectator_results_released: true });
      await mount(original);
      const modal = await openPlacement();
      await change(seasonField('archive-season'), '509');
      await click(button(MOVE, modal));
      const message =
        failure === 'network'
          ? 'Network disconnected'
          : `Move rejected (${failure})`;
      await fail(
        request('/events/31', 'PATCH'),
        failure === 'network'
          ? new TypeError(message)
          : new ApiError(message, failure, { error: message }),
      );
      expect(alertText(dialog())).toContain(message);
      expect(context.selectedEvent).toEqual(original);
      expect(context.events).toEqual([original]);
      expect(seasonField('archive-season').value).toBe('509');
      expect(mocks.toast.success).not.toHaveBeenCalled();
      expect(context.reconcileEvent).not.toHaveBeenCalled();
      expect(context.refreshEvents).not.toHaveBeenCalled();
      await click(button(MOVE, dialog()));
      const retry = request('/events/31', 'PATCH', 1);
      expect(retry.options.body).toEqual({
        spectator_listing: 'archive',
        season_id: 509,
      });
      // Deliberately differ from the submitted season and original release state:
      // reconciliation must use the complete server Event, not a local toggle.
      const saved = {
        ...original,
        spectator_listing: 'archive',
        season_id: 701,
        name: 'Server saved event',
        spectator_results_released: false,
      } satisfies Event;
      await respond(retry, saved);
      expect(context.reconcileEvent).toHaveBeenCalledExactlyOnceWith(saved);
      expect(context.refreshEvents).toHaveBeenCalledTimes(1);
      expect(context.setSelectedEvent).not.toHaveBeenCalled();
      expect(container.querySelector('dialog')).toBeNull();
      expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    },
  );

  it('guards same-turn duplicate moves and disables Cancel, native close, backdrop and Escape while saving', async () => {
    await mount(makeEvent(31, { season_id: 701 }));
    const modal = await openPlacement();
    const move = button(MOVE, modal);
    await act(async () => {
      move.click();
      move.click();
    });
    expect(matchingRequests('/events/31', 'PATCH')).toHaveLength(1);
    expect(move.disabled).toBe(true);
    expect(button('Cancel', modal).disabled).toBe(true);
    expect(button('Dismiss dialog', modal).disabled).toBe(true);
    await click(button('Cancel', modal));
    await escape(modal);
    await dismissBackdrop(modal);
    await act(async () => modal.close());
    expect(modal.open).toBe(true);
    expect(dialog()).toBe(modal);
    await respond(
      request('/events/31', 'PATCH'),
      makeEvent(31, { spectator_listing: 'archive', season_id: 701 }),
    );
    expect(container.querySelector('dialog')).toBeNull();
    expect(context.reconcileEvent).toHaveBeenCalledTimes(1);
    expect(context.refreshEvents).toHaveBeenCalledTimes(1);
  });

  it('creates a season from an empty catalog, blocks dismissal/duplicates while creating, and reuses it after assignment failure', async () => {
    await mount(makeEvent(31), []);
    const modal = await openPlacement();
    const fields = await beginSeasonCreation(modal);
    await change(fields.name, '2027 Finals');
    await change(fields.order, '17');
    await act(async () => {
      fields.create.click();
      fields.create.click();
    });
    const create = request('/events/seasons', 'POST');
    expect(matchingRequests('/events/seasons', 'POST')).toHaveLength(1);
    expect(button('Cancel', modal).disabled).toBe(true);
    expect(button('Dismiss dialog', modal).disabled).toBe(true);
    expect(button(MOVE, modal).disabled).toBe(true);
    await escape(modal);
    await dismissBackdrop(modal);
    await act(async () => modal.close());
    expect(dialog()).toBe(modal);
    const savedSeason = { id: 913, name: '2027 Finals', sort_order: 17 };
    await respond(create, savedSeason);
    expect(seasonField('archive-season').value).toBe('913');
    expect(button('Cancel', modal).disabled).toBe(false);
    const successesAfterCreation = mocks.toast.success.mock.calls.length;
    await click(button(MOVE, modal));
    await fail(
      request('/events/31', 'PATCH'),
      new ApiError('Assignment failed', 500, null),
    );
    expect(alertText(modal)).toContain('Assignment failed');
    expect(seasonField('archive-season').value).toBe('913');
    expect(mocks.toast.success).toHaveBeenCalledTimes(successesAfterCreation);
    await click(button(MOVE, modal));
    expect(matchingRequests('/events/seasons', 'POST')).toHaveLength(1);
    expect(request('/events/31', 'PATCH', 1).options.body).toEqual({
      spectator_listing: 'archive',
      season_id: 913,
    });
    await respond(
      request('/events/31', 'PATCH', 1),
      makeEvent(31, { spectator_listing: 'archive', season_id: 913 }),
    );
    expect(container.querySelector('dialog')).toBeNull();
    expect(mocks.toast.success.mock.calls.length).toBe(
      successesAfterCreation + 1,
    );
  });

  it.each(['setup', 'complete', 'archived'] as const)(
    'returns a %s event to current by omission, without releasing results, clearing season or changing status',
    async (status) => {
      const original = makeEvent(31, {
        status,
        spectator_listing: 'archive',
        season_id: 701,
      });
      await mount(original);
      const modal = await openPlacement(RETURN);
      expect(text(modal)).toContain(original.name);
      await click(button(RETURN, modal));
      const patch = request('/events/31', 'PATCH');
      expect(patch.options.body).toEqual({ spectator_listing: 'current' });
      const saved = {
        ...original,
        spectator_listing: 'current',
      } satisfies Event;
      await respond(patch, saved);
      expect(context.reconcileEvent).toHaveBeenCalledExactlyOnceWith(saved);
      expect(context.refreshEvents).toHaveBeenCalledTimes(1);
      expect(container.querySelector('dialog')).toBeNull();
    },
  );

  it('does not select the old event or touch another event form when a pending move completes', async () => {
    const first = makeEvent(31, { season_id: 701 });
    const second = makeEvent(47, { season_id: 509 });
    await mount(first);
    context.events = [first, second];
    await render();
    const modal = await openPlacement();
    await click(button(MOVE, modal));
    context.selectedEvent = second;
    await render();
    // The pending dialog remains tied to its original event, or is removed.
    const pendingDialog = container.querySelector('dialog[open]');
    if (pendingDialog) {
      expect(text(pendingDialog)).toContain(first.name);
      expect(text(pendingDialog)).not.toContain(second.name);
    }
    await click(button('Edit', container.querySelector('.card')!));
    const secondForm = Array.from(container.querySelectorAll('dialog')).find(
      (element) => text(element).includes('Edit Event'),
    )!;
    await change(
      field<HTMLInputElement>('Event Name', secondForm),
      'Second unsaved edit',
    );
    const saved = {
      ...first,
      name: 'Server saved first event',
      spectator_listing: 'archive',
      season_id: 509,
    } satisfies Event;
    await respond(request('/events/31', 'PATCH'), saved);
    expectPersisted(saved);
    expect(context.events).toEqual([saved, second]);
    expect(context.selectedEvent).toEqual(second);
    expect(context.setSelectedEvent).not.toHaveBeenCalled();
    expect(secondForm.isConnected).toBe(true);
    expect(field<HTMLInputElement>('Event Name', secondForm).value).toBe(
      'Second unsaved edit',
    );
    expect(field<HTMLSelectElement>('Season', secondForm).value).toBe('509');
    expect(matchingRequests('/events/47', 'PATCH')).toEqual([]);
  });

  it('reconciles a late successful move into the persistent provider after UI unmount without stale UI callbacks', async () => {
    const original = makeEvent(31, { season_id: 701 });
    const other = makeEvent(47, { season_id: 509 });
    await mount(original);
    await openPlacement();
    await click(button(MOVE, dialog()));
    const pending = request('/events/31', 'PATCH');
    expect(pending.options.body).toEqual({
      spectator_listing: 'archive',
      season_id: 701,
    });
    expect(context.beginEventMutation).toHaveBeenCalledTimes(1);
    expect(context.reconcileEvent).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    root = null;
    context.events = [original, other];
    context.selectedEvent = other;
    const saved = {
      ...original,
      name: 'Server saved archive event',
      spectator_listing: 'archive',
      season_id: 509,
      spectator_results_released: true,
      updated_at: '2026-06-01T12:00:00Z',
    } satisfies Event;
    await respond(pending, saved);
    expectPersisted(saved);
    expect(context.events).toEqual([saved, other]);
    expect(context.selectedEvent).toEqual(other);
    expect(context.setSelectedEvent).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(container.querySelector('dialog')).toBeNull();
  });

  it.each([
    ['move', 'failure'],
    ['season creation', 'success'],
    ['season creation', 'failure'],
  ])(
    'ignores late dialog %s %s callbacks after EventsTab unmounts',
    async (operation, result) => {
      const original = makeEvent(31, { season_id: 701 });
      await mount(original);
      await openPlacement();
      let pending: Request;
      if (operation === 'move') {
        await click(button(MOVE, dialog()));
        pending = request('/events/31', 'PATCH');
      } else {
        const fields = await beginSeasonCreation();
        await change(fields.name, 'Future season');
        await click(fields.create);
        pending = request('/events/seasons', 'POST');
      }
      await act(async () => root!.unmount());
      root = null;
      if (result === 'success')
        await respond(pending, {
          id: 913,
          name: 'Future season',
          sort_order: 0,
        });
      else await fail(pending, new TypeError('Late network failure'));
      expect(context.reconcileEvent).not.toHaveBeenCalled();
      expect(context.refreshEvents).not.toHaveBeenCalled();
      expect(context.events).toEqual([original]);
      expect(context.selectedEvent).toEqual(original);
      expect(context.setSelectedEvent).not.toHaveBeenCalled();
      expect(mocks.toast.success).not.toHaveBeenCalled();
      expect(mocks.toast.error).not.toHaveBeenCalled();
    },
  );
});

describe('EventsTab independent admin filters', () => {
  it('starts with all placements, combines lifecycle/placement filters, and labels hidden status locally', async () => {
    const fixtures = [
      makeEvent(31, { name: 'Current complete with season', season_id: 701 }),
      makeEvent(47, {
        name: 'Archive complete',
        spectator_listing: 'archive',
        season_id: 701,
      }),
      makeEvent(53, { name: 'Current setup', status: 'setup' }),
      makeEvent(67, {
        name: 'Hidden archive',
        status: 'archived',
        spectator_listing: 'archive',
        season_id: 509,
      }),
    ];
    context.events = fixtures;
    await render();
    await respond(request('/events/seasons'), seasons);
    const lifecycle = field<HTMLSelectElement>('Lifecycle status');
    const placement = field<HTMLSelectElement>('Spectator placement');
    expect(lifecycle.value).toBe('all');
    expect(placement.value).toBe('all');
    expect(Array.from(placement.options).map((option) => option.value)).toEqual(
      ['all', 'current', 'archive'],
    );
    expect(
      text(
        Array.from(lifecycle.options).find(
          (option) => option.value === 'archived',
        )!,
      ),
    ).toBe('Hidden from Spectators');
    const names = () =>
      Array.from(container.querySelectorAll('tbody tr')).map(
        (row) => row.querySelector('strong')?.textContent,
      );
    expect(names()).toEqual(fixtures.map((event) => event.name));
    expect(text(container.querySelector('tbody')!)).toContain(seasons[0].name);
    expect(text(container.querySelector('tbody')!)).toContain(
      'Spectator Archive',
    );
    await change(placement, 'archive');
    expect(lifecycle.value).toBe('all');
    expect(names()).toEqual(['Archive complete', 'Hidden archive']);
    await change(lifecycle, 'complete');
    expect(placement.value).toBe('archive');
    expect(names()).toEqual(['Archive complete']);
    await change(placement, 'current');
    expect(lifecycle.value).toBe('complete');
    expect(names()).toEqual(['Current complete with season']);
    await change(lifecycle, 'archived');
    expect(names()).toEqual([]);
    await change(placement, 'archive');
    expect(names()).toEqual(['Hidden archive']);
    expect(text(container.querySelector('tbody')!)).toContain(
      'Hidden from Spectators',
    );
    expect(mutations()).toEqual([]);
  });
});
