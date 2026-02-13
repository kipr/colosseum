import React, { createContext, useContext, useRef, useCallback } from 'react';

export type AnchorKind = 'team1' | 'team2';

interface AnchorMap {
  team1?: HTMLElement | null;
  team2?: HTMLElement | null;
}

interface BracketAnchorRegistryContextValue {
  register: (
    gameId: number,
    anchor: AnchorKind,
    el: HTMLElement | null,
  ) => void;
  getAnchors: () => Map<number, AnchorMap>;
}

const BracketAnchorRegistryContext =
  createContext<BracketAnchorRegistryContextValue | null>(null);

export function BracketAnchorRegistryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const mapRef = useRef<Map<number, AnchorMap>>(new Map());

  const register = useCallback(
    (gameId: number, anchor: AnchorKind, el: HTMLElement | null) => {
      let entry = mapRef.current.get(gameId);
      if (!entry) {
        entry = {};
        mapRef.current.set(gameId, entry);
      }
      entry[anchor] = el ?? undefined;
      if (!el && (!entry.team1 || !entry.team2)) {
        const hasAny = entry.team1 || entry.team2;
        if (!hasAny) {
          mapRef.current.delete(gameId);
        }
      }
    },
    [],
  );

  const getAnchors = useCallback(() => {
    const snapshot = new Map<number, AnchorMap>();
    mapRef.current.forEach((v, k) => {
      snapshot.set(k, { ...v });
    });
    return snapshot;
  }, []);

  const value: BracketAnchorRegistryContextValue = {
    register,
    getAnchors,
  };

  return (
    <BracketAnchorRegistryContext.Provider value={value}>
      {children}
    </BracketAnchorRegistryContext.Provider>
  );
}

export function useBracketAnchorRegistry(): BracketAnchorRegistryContextValue {
  const ctx = useContext(BracketAnchorRegistryContext);
  if (!ctx) {
    throw new Error(
      'useBracketAnchorRegistry must be used within BracketAnchorRegistryProvider',
    );
  }
  return ctx;
}
