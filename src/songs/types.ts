export type SongSource = 'builtin' | 'midi' | 'musicxml';
export type Hand = 'L' | 'R' | 'unknown';

export interface SongNote {
  startTick: number;
  durationTick: number;
  midi: number;
  hand: Hand;
  velocity: number; // 0-127
}

export interface TempoEvent {
  tick: number;
  bpm: number;
}

export interface PedalEvent {
  tick: number;
  down: boolean;
}

export interface PracticeSong {
  id: string;
  title: string;
  composer: string;
  source: SongSource;
  ppq: number;
  tempoMap: TempoEvent[];
  notes: SongNote[];
  pedalEvents: PedalEvent[]; // source fidelity; no v1 runtime consumer
  playableRange: { min: number; max: number };
  maxSimultaneity: number;
  // Semitones added to the default window base (MIDI 60) so the song's range
  // centers in the mapped 18-semitone window. Always a multiple of 12.
  baseWindowOffset: number;
}

export interface GroupNote {
  midi: number;
  durationSec: number;
  hand: Hand;
  velocity: number;
}

export interface NoteGroup {
  startSec: number; // onset at 1x speed
  notes: GroupNote[];
}

export interface CompiledSong {
  song: PracticeSong;
  groups: NoteGroup[];
  durationSec: number; // end of the last note at 1x
}

export interface ImportWarning {
  kind: 'grace-notes-dropped' | 'chords-thinned' | 'multi-part' | 'range-folded';
  message: string;
}

export interface ImportValidation {
  rangeFits: boolean;
  maxSimultaneity: number;
  warnings: ImportWarning[];
}

export class SongFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SongFormatError';
  }
}
