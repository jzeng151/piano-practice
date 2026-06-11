import type { BuiltinDef } from './types';

// Pachelbel — Canon (simplified), transposed to C. The famous progression
// (I V vi iii IV I IV V) as low-region whole notes under the canon theme in
// half notes, then the quarter-note variation. 4/4.
const C4 = 60, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76, F5 = 77;

const notes: BuiltinDef['notes'] = [];
const BASS = [C4, G4, A4, E4, F4, C4, F4, G4];

let bar = 0;
const L = (beat: number, dur: number, midi: number) => notes.push([bar * 4 + beat, dur, midi, 'L']);
const R = (beat: number, dur: number, midi: number) => notes.push([bar * 4 + beat, dur, midi, 'R']);
const next = () => bar++;

// Round 1 — canon theme in half notes over the bass cycle (theme walks its
// 8 half-notes across 4 bars; played twice = one full 8-bar bass cycle)
const THEME_HALVES = [E5, D5, C5, B4, A4, G4, A4, B4];
for (let i = 0; i < 8; i++) {
  L(0, 4, BASS[i % 8]);
  R(0, 2, THEME_HALVES[(i * 2) % 8]);
  R(2, 2, THEME_HALVES[(i * 2 + 1) % 8]);
  next();
}

// Round 2 — quarter-note variation: C5 E5 D5 C5 | B4 D5 C5 B4 | A4 C5 B4 A4 | G4 B4 A4 G4 ×2
const VAR: number[][] = [
  [C5, E5, D5, C5],
  [B4, D5, C5, B4],
  [A4, C5, B4, A4],
  [G4, B4, A4, B4],
  [C5, E5, D5, F5],
  [E5, D5, C5, B4],
  [A4, C5, B4, A4],
  [G4, B4, C5, D5],
];
for (let i = 0; i < 8; i++) {
  L(0, 4, BASS[i % 8]);
  VAR[i].forEach((m, q) => R(q, 1, m));
  next();
}

// Final cadence
L(0, 4, C4);
R(0, 4, C5);

export const canonInD: BuiltinDef = {
  id: 'builtin-canon-in-d',
  title: 'Canon (simplified)',
  composer: 'Johann Pachelbel',
  bpm: 100,
  difficulty: 1,
  notes,
};
