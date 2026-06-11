import type { BuiltinDef } from './types';

// Satie — Gymnopédie No. 1 (arranged spike piece: hardest natural span).
// 3/4. Arranged into one 18-semitone window (C4–F5, MIDI 60–77):
// bass single note on beat 1 (low region), one chord tone on beat 2,
// melody floating above. ≤3 simultaneous notes throughout.
// Original D major transposed/compressed; melody contour preserved.
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71;
const C5 = 72, Cs5 = 73, D5 = 74, E5 = 76, F5 = 77;
const Fs4 = 66, Gs4 = 68, As4 = 70;

const notes: BuiltinDef['notes'] = [];
let bar = 0;
const L = (beat: number, dur: number, ...ms: number[]) => {
  for (const m of ms) notes.push([bar * 3 + beat, dur, m, 'L']);
};
const R = (beat: number, dur: number, ...ms: number[]) => {
  for (const m of ms) notes.push([bar * 3 + beat, dur, m, 'R']);
};
const next = () => bar++;

// Intro vamp (bars 1-4): G bass, B+D color on beat 2 — the famous sway.
for (let i = 0; i < 2; i++) {
  L(0, 1, C4); L(1, 2, G4, B4); next();
  L(0, 1, D4); L(1, 2, A4, C5); next();
}
// Melody enters (original: F# A G F# C# B C# D A...) mapped to contour
// E5 F5 E5 D5 ... within the window, over the same vamp.
L(0, 1, C4); L(1, 2, G4, B4); R(2, 1, F5); next();
L(0, 1, D4); L(1, 2, A4, C5); R(0, 1, E5); R(1, 1, F5); R(2, 1, E5); next();
L(0, 1, C4); L(1, 2, G4, B4); R(0, 3, D5); next();
L(0, 1, D4); L(1, 2, A4, C5); R(0, 3, B4); next();
L(0, 1, C4); L(1, 2, G4, B4); R(0, 1, C5); R(1, 1, D5); R(2, 1, B4); next();
L(0, 1, D4); L(1, 2, A4, C5); R(0, 3, A4); next();
L(0, 1, C4); L(1, 2, G4, B4); R(0, 3, G4); next();
L(0, 1, D4); L(1, 2, A4, C5); R(0, 3, A4); next();
// Second phrase (original rises then falls — C# D E F# E D C#…)
L(0, 1, C4); L(1, 2, G4, B4); R(2, 1, Cs5); next();
L(0, 1, D4); L(1, 2, A4, C5); R(0, 1, D5); R(1, 1, E5); R(2, 1, F5); next();
L(0, 1, C4); L(1, 2, Gs4, B4); R(0, 3, E5); next();
L(0, 1, D4); L(1, 2, A4, Cs5); R(0, 3, D5); next();
L(0, 1, C4); L(1, 2, G4, B4); R(0, 1, E5); R(1, 1, D5); R(2, 1, C5); next();
L(0, 1, D4); L(1, 2, A4, C5); R(0, 3, B4); next();
L(0, 1, E4); L(1, 2, G4, B4); R(0, 3, C5); next();
L(0, 1, F4); L(1, 2, A4, C5); R(0, 3, D5); next();
// Closing phrase: descent home with the modal F# color.
L(0, 1, C4); L(1, 2, Fs4, B4); R(0, 3, B4); next();
L(0, 1, D4); L(1, 2, Gs4, B4); R(0, 1, A4); R(1, 1, B4); R(2, 1, Cs5); next();
L(0, 1, E4); L(1, 2, A4, Cs5); R(0, 3, D5); next();
L(0, 1, D4); L(1, 2, As4, Cs5); R(0, 3, Cs5); next();
L(0, 1, C4); L(1, 2, G4, B4); R(0, 3, B4); next();
L(0, 1, D4); L(1, 2, A4, C5); R(0, 3, A4); next();
L(0, 1, C4); L(1, 2, G4, B4); R(0, 3, G4); next();
L(0, 2, C4); L(0, 2, G4); R(0, 3, E4 + 12); next();

export const gymnopedie1: BuiltinDef = {
  id: 'builtin-gymnopedie-1',
  title: 'Gymnopédie No. 1',
  composer: 'Erik Satie',
  bpm: 66,
  difficulty: 2,
  notes,
};
