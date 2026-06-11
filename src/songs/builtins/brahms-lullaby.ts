import type { BuiltinDef } from './types';

// Brahms — Wiegenlied (Lullaby), Op. 49 No. 4. F major sits natively in the
// C4–F5 window. 3/4; LH = gentle chord tones on beats 1 and 3.
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, Bb4 = 70, C5 = 72, D5 = 74, E5 = 76, F5 = 77;

const notes: BuiltinDef['notes'] = [];
let bar = 0;
const R = (beat: number, dur: number, midi: number) => notes.push([bar * 3 + beat, dur, midi, 'R']);
const L = (beat: number, dur: number, midi: number) => notes.push([bar * 3 + beat, dur, midi, 'L']);
const next = () => bar++;

// pickup: A4 A4 (eighths on beat 3)
R(2, 0.5, A4); R(2.5, 0.5, A4); next();
// C5 — | A4 A4 (pickup again)
L(0, 1, F4); L(1, 1, C4); R(0, 2, C5); R(2, 0.5, A4); R(2.5, 0.5, A4); next();
L(0, 1, F4); L(1, 1, C4); R(0, 3, C5); next();
// A4 C5 | F5 E5 — | D5 D5
R(0, 1, A4); L(0, 2, C4); R(1, 1, C5); R(2, 1, F5); next();
L(0, 1, C4); L(1, 1, E4); R(0, 2, E5); R(2, 0.5, D5); R(2.5, 0.5, D5); next();
// C5 — | D5 G4 ... (second phrase)
L(0, 1, F4); L(1, 1, C4); R(0, 3, C5); next();
R(0, 1, D5); L(0, 2, C4); R(1, 1, Bb4); R(2, 1, Bb4); next();
// A4 G4 | F4 ... cadence half
L(0, 1, C4); L(1, 1, E4); R(0, 1, A4); R(1, 1, G4); R(2, 1, A4); next();
L(0, 1, F4); L(1, 1, C4); R(0, 2, F4); R(2, 0.5, G4); R(2.5, 0.5, C5); next();
// final phrase: F4 G4 A4 | Bb4 C5 D5 | C5 A4 F4 cadence
L(0, 1, F4); R(0, 1, F4); R(1, 1, G4); R(2, 1, A4); next();
L(0, 1, D4); L(1, 1, F4); R(0, 1, Bb4); R(1, 1, C5); R(2, 1, D5); next();
L(0, 1, C4); L(1, 1, E4); R(0, 1, C5); R(1, 1, A4); R(2, 1, G4); next();
L(0, 3, C4); L(0, 3, F4); R(0, 3, A4); next();

export const brahmsLullaby: BuiltinDef = {
  id: 'builtin-brahms-lullaby',
  title: 'Lullaby (Wiegenlied)',
  composer: 'Johannes Brahms',
  bpm: 76,
  difficulty: 1,
  notes,
};
