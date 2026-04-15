import React, { createContext, useContext } from 'react';

const UnifiedTableScrollAffordanceContext = createContext(false);

/** When true (Spectator route), `UnifiedTable` adds horizontal scroll hint + edge fade when needed. */
export function useUnifiedTableScrollAffordance(): boolean {
  return useContext(UnifiedTableScrollAffordanceContext);
}

export function UnifiedTableScrollAffordanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UnifiedTableScrollAffordanceContext.Provider value={true}>
      {children}
    </UnifiedTableScrollAffordanceContext.Provider>
  );
}
