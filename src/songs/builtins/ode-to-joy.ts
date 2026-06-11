import type { BuiltinDef } from './types';

// Beethoven — Ode to Joy (theme). 4/4, G major in the C4–F5 window:
// melody G4–D5 (offsets 7–14), left hand single roots/fifths below.
const C4 = 60, D4 = 62, E4 = 64, G4 = 67, A4 = 69, B4 = 71, C5 = 72, D5 = 74;

const notes: BuiltinDef['notes'] = [];
let t = 0;
const R = (dur: number, midi: number) => {
  notes.push([t, dur, midi, 'R']);
  t += dur;
};
const Lat = (beat: number, dur: number, ...ms: number[]) => {
  for (const m of ms) notes.push([beat, dur, m, 'L']);
};

// Melody (B B C D | D C B A | G G A B | B. A A —) ×2 with second ending
const phrase = (ending: 'first' | 'second') => {
  R(1, B4); R(1, B4); R(1, C5); R(1, D5);
  R(1, D5); R(1, C5); R(1, B4); R(1, A4);
  R(1, G4); R(1, G4); R(1, A4); R(1, B4);
  if (ending === 'first') {
    R(1.5, B4); R(0.5, A4); R(2, A4);
  } else {
    R(1.5, A4); R(0.5, G4); R(2, G4);
  }
};
phrase('first');
phrase('second');
// B section: A A B G | A B-C B G | A B-C B A | G A D —
R(1, A4); R(1, A4); R(1, B4); R(1, G4);
R(1, A4); R(0.5, B4); R(0.5, C5); R(1, B4); R(1, G4);
R(1, A4); R(0.5, B4); R(0.5, C5); R(1, B4); R(1, A4);
R(1, G4); R(1, A4); R(2, D4 + 12);
// Reprise with second ending
phrase('second');

// Left hand: half-note chord tones on beats 1 and 3. G3 is below the window,
// so the bass voice uses the C4–E4 region (D = shared tone of G and D chords;
// C/E ground the cadences).
const bars = Math.ceil(t / 4);
for (let bar = 0; bar < bars; bar++) {
  const isCadence = bar % 4 === 3;
  Lat(bar * 4 + 0, 2, isCadence ? C4 : D4);
  Lat(bar * 4 + 2, 2, isCadence ? E4 : D4);
}

export const odeToJoy: BuiltinDef = {
  id: 'builtin-ode-to-joy',
  title: 'Ode to Joy (theme)',
  composer: 'Ludwig van Beethoven',
  bpm: 108,
  difficulty: 1,
  notes,
};
