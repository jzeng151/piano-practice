import type { BuiltinDef } from './types';

// Tchaikovsky — Swan Lake, Act II theme (the oboe melody), A minor in the
// window. 4/4; LH = tremolo-free sustained chord tones.
const C4 = 60, D4 = 62, E4 = 64, A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76, F5 = 77, Gs4 = 68;

const notes: BuiltinDef['notes'] = [];
let bar = 0;
const R = (beat: number, dur: number, midi: number) => notes.push([bar * 4 + beat, dur, midi, 'R']);
const L = (beat: number, dur: number, ...ms: number[]) => {
  for (const m of ms) notes.push([bar * 4 + beat, dur, m, 'L']);
};
const next = () => bar++;

const phrase = (cadence: 'half' | 'full') => {
  // E5 — — (A4 B4 C5 D5) | E5 — ...
  L(0, 4, C4, E4); R(0, 2, E5); R(2, 0.5, A4); R(2.5, 0.5, B4); R(3, 0.5, C5); R(3.5, 0.5, D5); next();
  L(0, 4, C4, E4); R(0, 2, E5); R(2, 0.5, A4); R(2.5, 0.5, B4); R(3, 0.5, C5); R(3.5, 0.5, D5); next();
  // E5 C5 A4 E5 | climb and fall
  L(0, 4, D4, E4); R(0, 1, E5); R(1, 1, C5); R(2, 1, A4); R(3, 1, E5); next();
  if (cadence === 'half') {
    L(0, 4, E4, Gs4); R(0, 2, D5); R(2, 2, B4); next();
  } else {
    L(0, 2, E4, Gs4); L(2, 2, C4, E4); R(0, 1, D5); R(1, 1, B4); R(2, 2, A4); next();
  }
};

phrase('half');
phrase('full');
// coda: rising cry — A4 C5 E5 | F5 E5 D5 C5 | B4 ... A4
L(0, 4, C4, E4); R(0, 1, A4); R(1, 1, C5); R(2, 2, E5); next();
L(0, 4, D4, E4); R(0, 1, F5); R(1, 1, E5); R(2, 1, D5); R(3, 1, C5); next();
L(0, 2, E4, Gs4); L(2, 2, E4, Gs4); R(0, 2, B4); R(2, 1, C5); R(3, 1, B4); next();
L(0, 4, C4, E4); R(0, 4, A4); next();

export const swanLake: BuiltinDef = {
  id: 'builtin-swan-lake',
  title: 'Swan Lake (Act II theme)',
  composer: 'P.I. Tchaikovsky',
  bpm: 84,
  difficulty: 2,
  notes,
};
