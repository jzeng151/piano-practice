import type { BuiltinDef } from './types';

// Bach — Prelude in C (WTC I, BWV 846), first 8 bars. The broken-chord
// pattern is kept broken — sequential 16ths, essentially no simultaneity.
// Voicings compressed so every chord fits the C4–F5 window.
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, Fs4 = 66, G4 = 67, A4 = 69, B4 = 71;
const C5 = 72, D5 = 74, E5 = 76, F5 = 77;

// Per bar: five pitches [a, b, c, d, e] played a b c d e c d e, twice.
// a/b are the left hand, c/d/e the right.
const BARS: [number, number, number, number, number][] = [
  [C4, E4, G4, C5, E5], // C
  [C4, D4, A4, D5, F5], // Dm7/C
  [D4, F4, G4, B4, F5], // G7/B (compressed)
  [C4, E4, G4, C5, E5], // C
  [C4, E4, A4, C5, E5], // Am/C
  [C4, D4, Fs4, A4, D5], // D7/C
  [D4, G4, B4, D5, F5], // G7
  [C4, E4, G4, C5, E5], // C
];

const notes: BuiltinDef['notes'] = [];
BARS.forEach(([a, b, c, d, e], bar) => {
  for (let half = 0; half < 2; half++) {
    const t0 = bar * 4 + half * 2;
    const SIXTEENTH = 0.25;
    const seq: [number, 'L' | 'R'][] = [
      [a, 'L'], [b, 'L'], [c, 'R'], [d, 'R'], [e, 'R'], [c, 'R'], [d, 'R'], [e, 'R'],
    ];
    seq.forEach(([midi, hand], i) => {
      notes.push([t0 + i * SIXTEENTH, SIXTEENTH, midi, hand]);
    });
  }
});
// closing C
notes.push([32, 4, C4, 'L'], [32, 4, E4, 'R'], [32, 4, C5, 'R']);

export const preludeInC: BuiltinDef = {
  id: 'builtin-prelude-in-c',
  title: 'Prelude in C (BWV 846)',
  composer: 'J.S. Bach',
  bpm: 72,
  difficulty: 2,
  notes,
};
