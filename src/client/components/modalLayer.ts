import { useSyncExternalStore } from 'react';

const dialogs: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function registerModalLayer(dialog: HTMLDialogElement) {
  dialogs.push(dialog);
  notify();
  return () => {
    const index = dialogs.indexOf(dialog);
    if (index !== -1) dialogs.splice(index, 1);
    notify();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useModalLayer() {
  return useSyncExternalStore(
    subscribe,
    () => dialogs[dialogs.length - 1] ?? null,
    () => null,
  );
}
