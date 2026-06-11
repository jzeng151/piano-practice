import type { Hand, PracticeSong } from '../types';
import { withDerived } from '../compile';

export const BUILTIN_PPQ = 480;

// [startBeat, durationBeats, midi, hand]
export type BuiltinNote = [number, number, number, Hand];

export interface BuiltinDef {
  id: string;
  title: string;
  composer: string;
  bpm: number;
  difficulty: 1 | 2 | 3;
  notes: BuiltinNote[];
}

export function builtinToSong(def: BuiltinDef): PracticeSong {
  return withDerived({
    id: def.id,
    title: def.title,
    composer: def.composer,
    source: 'builtin',
    ppq: BUILTIN_PPQ,
    tempoMap: [{ tick: 0, bpm: def.bpm }],
    notes: def.notes.map(([startBeat, durBeats, midi, hand]) => ({
      startTick: Math.round(startBeat * BUILTIN_PPQ),
      durationTick: Math.max(1, Math.round(durBeats * BUILTIN_PPQ)),
      midi,
      hand,
      velocity: hand === 'L' ? 72 : 92,
    })),
    pedalEvents: [],
    playableRange: { min: 0, max: 0 },
    maxSimultaneity: 0,
    baseWindowOffset: 0,
  });
}
