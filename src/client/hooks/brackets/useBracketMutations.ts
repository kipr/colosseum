import { useCallback, useState } from 'react';
import type {
  Bracket,
  BracketStatus,
  CreateBracketBody,
  GenerateEntriesResult,
  GenerateGamesResult,
  PatchBracketBody,
} from '../../types/brackets';
import {
  createBracket as createBracketRequest,
  deleteBracket as deleteBracketRequest,
  generateEntries as generateEntriesRequest,
  generateGames as generateGamesRequest,
  patchBracket,
} from '../../api/brackets';

export function useBracketMutations() {
  const [saving, setSaving] = useState(false);
  const [generatingEntries, setGeneratingEntries] = useState(false);
  const [generatingGames, setGeneratingGames] = useState(false);

  const create = useCallback(
    async (body: CreateBracketBody): Promise<Bracket> => {
      setSaving(true);
      try {
        return await createBracketRequest(body);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const update = useCallback(
    async (bracketId: number, body: PatchBracketBody): Promise<Bracket> => {
      setSaving(true);
      try {
        return await patchBracket(bracketId, body);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const changeStatus = useCallback(
    async (bracketId: number, status: BracketStatus): Promise<Bracket> => {
      return patchBracket(bracketId, { status });
    },
    [],
  );

  const remove = useCallback(async (bracketId: number): Promise<void> => {
    await deleteBracketRequest(bracketId);
  }, []);

  const generateEntries = useCallback(
    async (
      bracketId: number,
      force: boolean,
    ): Promise<GenerateEntriesResult> => {
      setGeneratingEntries(true);
      try {
        return await generateEntriesRequest(bracketId, force);
      } finally {
        setGeneratingEntries(false);
      }
    },
    [],
  );

  const generateGames = useCallback(
    async (bracketId: number, force: boolean): Promise<GenerateGamesResult> => {
      setGeneratingGames(true);
      try {
        return await generateGamesRequest(bracketId, force);
      } finally {
        setGeneratingGames(false);
      }
    },
    [],
  );

  return {
    saving,
    generatingEntries,
    generatingGames,
    create,
    update,
    changeStatus,
    remove,
    generateEntries,
    generateGames,
  };
}
