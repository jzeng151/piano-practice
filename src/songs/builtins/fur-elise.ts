import type { BuiltinDef } from './types';

// Beethoven — Für Elise (A section). 3/8 felt in eighth notes (1 beat = one
// eighth here; bpm is the eighth-note rate). The E5–D#5 alternation is kept
// verbatim — repeated notes are exactly what the wait-gate must demand fresh
// strikes for. LH arpeggios compressed to single low-region notes.
const C4 = 60, D4 = 62, E4 = 64, Gs4 = 68, A4 = 69, B4 = 71, C5 = 72, D5 = 74, Ds5 = 75, E5 = 76;

const notes: BuiltinDef['notes'] = [];
let t = 0;
const R = (dur: number, midi: number) => {
  notes.push([t, dur, midi, 'R']);
  t += dur;
};
const Lat = (at: number, dur: number, midi: number) => notes.push([at, dur, midi, 'L']);
const rest = (dur: number) => {
  t += dur;
};

const figure = (ending: 'toB' | 'toA') => {
  // E5 D#5 E5 D#5 E5 B4 D5 C5 | A4 —
  R(1, E5); R(1, Ds5);
  R(1, E5); R(1, Ds5); R(1, E5); R(1, B4); R(1, D5); R(1, C5);
  Lat(t, 1, C4); R(2, A4); rest(0);
  // connective run up: C4 E4 A4 → B4 —
  R(1, C4); R(1, E4); R(1, A4);
  Lat(t, 1, D4); R(2, B4);
  // E4 G#4 B4 → C5 —
  R(1, E4); R(1, Gs4); R(1, B4);
  if (ending === 'toB') {
    Lat(t, 1, C4); R(2, C5);
  } else {
    Lat(t, 1, C4); R(2, A4);
  }
};

figure('toB');
figure('toA');
figure('toB');
figure('toA');
// closing echo of the alternation, settling on A
R(1, E5); R(1, Ds5); R(1, E5); R(1, Ds5); R(1, E5); R(1, B4); R(1, D5); R(1, C5);
Lat(t, 2, C4); Lat(t, 2, E4); R(3, A4);

export const furElise: BuiltinDef = {
  id: 'builtin-fur-elise',
  title: 'Für Elise (A section)',
  composer: 'Ludwig van Beethoven',
  bpm: 220, // eighth-note pulse (≈ dotted-quarter 73)
  difficulty: 2,
  notes,
};
