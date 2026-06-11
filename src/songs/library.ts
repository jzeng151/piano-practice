import { BUILTINS } from './builtins';
import { builtinToSong, type BuiltinDef } from './builtins/types';
import type { PracticeSong } from './types';

const cache = new Map<string, PracticeSong>();

export function listBuiltins(): BuiltinDef[] {
  return BUILTINS;
}

export function getBuiltinSong(id: string): PracticeSong | null {
  if (cache.has(id)) return cache.get(id)!;
  const def = BUILTINS.find((b) => b.id === id);
  if (!def) return null;
  const song = builtinToSong(def);
  cache.set(id, song);
  return song;
}
