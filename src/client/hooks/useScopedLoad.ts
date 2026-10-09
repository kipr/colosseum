import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from 'react';

export interface ScopedLoadOptions<T> {
  /** Returned while the current key has no data. Read once, on mount. */
  initial: T;
  enabled?: boolean;
  /** Called when the latest request fails; superseded requests are ignored. */
  onError?: (error: unknown) => void;
}

export interface ScopedLoad<T> {
  data: T;
  loading: boolean;
  /** Refetches the current key. Resolves once the request settles. */
  reload: () => Promise<void>;
  /** Updates the current key's data in place, as if it had been fetched. */
  setData: (update: SetStateAction<T>) => void;
}

type ScopeKey = string | number;

interface Snapshot<K, T> {
  key: K;
  data: T;
  loaded: boolean;
  loading: boolean;
}

/**
 * Loads data scoped to a key (usually an event or bracket id).
 *
 * - The data belongs to the key it was fetched for: when the key changes the
 *   hook returns `initial` until the new key's response arrives, so a view
 *   never shows one event's rows under another.
 * - Only the latest request may commit. Starting another load, changing the
 *   key, disabling the hook or unmounting aborts the one in flight, so a slow
 *   response for a previous key cannot overwrite the current one.
 * - A null key loads nothing and returns `initial`.
 * - `enabled: false` defers the load (for lazily loaded tabs). Once loaded,
 *   the data is kept for that key and not refetched when re-enabled; call
 *   `reload` to refresh it.
 */
export function useScopedLoad<K extends ScopeKey, T>(
  key: K | null,
  load: (key: K, signal: AbortSignal) => Promise<T>,
  { initial, enabled = true, onError }: ScopedLoadOptions<T>,
): ScopedLoad<T> {
  const [initialData] = useState(initial);
  const [snapshot, setSnapshot] = useState<Snapshot<K, T> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const loadRef = useRef(load);
  loadRef.current = load;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const current = key !== null && snapshot?.key === key ? snapshot : null;
  const loaded = current?.loaded ?? false;

  const run = useCallback(
    async (target: K) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setSnapshot((prev) =>
        prev?.key === target
          ? { ...prev, loading: true }
          : { key: target, data: initialData, loaded: false, loading: true },
      );
      try {
        const data = await loadRef.current(target, controller.signal);
        if (controller.signal.aborted) return;
        setSnapshot({ key: target, data, loaded: true, loading: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        // A failed refresh keeps the data already shown for this key.
        setSnapshot((prev) =>
          prev?.key === target ? { ...prev, loading: false } : prev,
        );
        onErrorRef.current?.(error);
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [initialData],
  );

  useEffect(() => {
    if (key === null || !enabled || loaded) return;
    void run(key);
  }, [key, enabled, loaded, run]);

  // Leaving a key (or disabling the hook) abandons its request, whether the
  // effect above or `reload` started it.
  useEffect(
    () => () => {
      if (!controllerRef.current) return;
      controllerRef.current.abort();
      controllerRef.current = null;
      setSnapshot((prev) =>
        prev?.key === key && prev.loading ? { ...prev, loading: false } : prev,
      );
    },
    [key, enabled],
  );

  const reload = useCallback(async () => {
    if (keyRef.current !== null) await run(keyRef.current);
  }, [run]);

  const setData = useCallback((update: SetStateAction<T>) => {
    const target = keyRef.current;
    setSnapshot((prev) =>
      prev && prev.key === target
        ? {
            ...prev,
            data:
              typeof update === 'function'
                ? (update as (prev: T) => T)(prev.data)
                : update,
          }
        : prev,
    );
  }, []);

  return {
    data: current ? current.data : initialData,
    loading: current ? current.loading : key !== null && enabled,
    reload,
    setData,
  };
}
