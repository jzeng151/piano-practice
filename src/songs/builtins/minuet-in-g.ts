import type { BuiltinDef } from './types';

// Bach — Minuet in G (Anh. 114), transposed to F so the melody crests at F5
// inside the C4–F5 window. 3/4; LH = single chord tones on beats 1/3.
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, Bb4 = 70, C5 = 72, D5 = 74, E5 = 76, F5 = 77;

const notes: BuiltinDef['notes'] = [];
let bar = 0;
const R = (beat: number, dur: number, midi: number) => notes.push([bar * 3 + beat, dur, midi, 'R']);
const L = (beat: number, dur: number, midi: number) => notes.push([bar * 3 + beat, dur, midi, 'L']);
const next = () => bar++;

// Phrase 1 (original bars 1–8, down a whole step)
L(0, 2, C4); R(0, 1, C5); R(1, 0.5, F4); R(1.5, 0.5, G4); R(2, 0.5, A4); R(2.5, 0.5, Bb4); next();
L(0, 2, D4); R(0, 1, C5); R(1, 1, F4); R(2, 1, F4); next();
L(0, 2, C4); R(0, 1, D5); R(1, 0.5, Bb4); R(1.5, 0.5, C5); R(2, 0.5, D5); R(2.5, 0.5, E5); next();
L(0, 2, C4); R(0, 1, F5); R(1, 1, F4); R(2, 1, F4); next();
L(0, 2, D4); R(0, 1, Bb4); R(1, 0.5, C5); R(1.5, 0.5, Bb4); R(2, 0.5, A4); R(2.5, 0.5, G4); next();
L(0, 2, E4); R(0, 1, A4); R(1, 0.5, Bb4); R(1.5, 0.5, A4); R(2, 0.5, G4); R(2.5, 0.5, F4); next();
L(0, 2, C4); R(0, 1, E4); R(1, 0.5, F4); R(1.5, 0.5, G4); R(2, 1, E4); next();
L(0, 1, C4); L(1, 1, E4); R(0, 3, F4); next();

// Phrase 2 (bars 9–16): same opening, cadencing home
L(0, 2, C4); R(0, 1, C5); R(1, 0.5, F4); R(1.5, 0.5, G4); R(2, 0.5, A4); R(2.5, 0.5, Bb4); next();
L(0, 2, D4); R(0, 1, C5); R(1, 1, F4); R(2, 1, F4); next();
L(0, 2, C4); R(0, 1, D5); R(1, 0.5, Bb4); R(1.5, 0.5, C5); R(2, 0.5, D5); R(2.5, 0.5, E5); next();
L(0, 2, C4); R(0, 3, F5); next();
L(0, 2, D4); R(0, 1, C5); R(1, 0.5, D5); R(1.5, 0.5, C5); R(2, 0.5, Bb4); R(2.5, 0.5, A4); next();
L(0, 2, E4); R(0, 1, Bb4); R(1, 0.5, C5); R(1.5, 0.5, Bb4); R(2, 0.5, A4); R(2.5, 0.5, G4); next();
L(0, 2, C4); R(0, 1, A4); R(1, 1, G4); R(2, 1, G4); next();
L(0, 3, C4); L(0, 3, E4); R(0, 3, F4); next();

export const minuetInG: BuiltinDef = {
  id: 'builtin-minuet-in-g',
  title: 'Minuet in G (Anh. 114)',
  composer: 'J.S. Bach (attr. Petzold)',
  bpm: 116,
  difficulty: 1,
  notes,
};
