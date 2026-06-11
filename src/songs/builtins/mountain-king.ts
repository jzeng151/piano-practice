import type { BuiltinDef } from './types';

// Grieg — In the Hall of the Mountain King, the creeping theme. A minor in
// the window; eighth notes with REPEATED pitches (the wait-gate's fresh-strike
// rule gets a real workout). Two statements: low region (as 'L'), then the
// answer in the upper region (as 'R') over a held drone.
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, Fs4 = 66, G4 = 67, A4 = 69;
const B4 = 71, C5 = 72, D5 = 74, Ds5 = 75, E5 = 76, F5 = 77;

const notes: BuiltinDef['notes'] = [];
let t = 0;
const seq = (hand: 'L' | 'R', dur: number, ...ms: number[]) => {
  for (const m of ms) {
    notes.push([t, dur, m, hand]);
    t += dur;
  }
};
const at = (atBeat: number, dur: number, midi: number, hand: 'L' | 'R') =>
  notes.push([atBeat, dur, midi, hand]);

// Statement 1 (lower voice): A B C D | E C E — | D# B D# — | D B D? — classic:
// A B C D E C E | D# B D# | D B D | A B C D E C E A G E C E A(long)
seq('L', 0.5, C4, D4, E4, F4, G4, E4, G4);
seq('L', 1, G4); // hold
seq('L', 0.5, Fs4, D4, Fs4);
seq('L', 1, Fs4);
seq('L', 0.5, F4, D4, F4);
seq('L', 1, F4);
seq('L', 0.5, C4, D4, E4, F4, G4, E4, G4);
seq('L', 0.5, C5, A4, G4, E4, G4);
seq('L', 1.5, A4);

// Statement 2 (upper voice): the theme an octave up over low drones.
let phraseStart = t;
seq('R', 0.5, A4, B4, C5, D5, E5, C5, E5);
seq('R', 1, E5);
at(phraseStart, t - phraseStart, C4, 'L');

phraseStart = t;
seq('R', 0.5, Ds5, B4, Ds5);
seq('R', 1, Ds5);
seq('R', 0.5, D5, B4, D5);
seq('R', 1, D5);
at(phraseStart, t - phraseStart, D4, 'L');

phraseStart = t;
seq('R', 0.5, A4, B4, C5, D5, E5, C5, E5);
seq('R', 0.5, F5, E5, C5, A4, C5);
seq('R', 2, A4);
at(phraseStart, t - phraseStart, C4, 'L');

// Final stinger chords
at(t, 1, A4, 'R');
at(t, 1, E4, 'L');
at(t, 1, C4, 'L');
t += 1.5;
at(t, 1.5, A4, 'R');
at(t, 1.5, E4, 'L');
at(t, 1.5, C4, 'L');

export const mountainKing: BuiltinDef = {
  id: 'builtin-mountain-king',
  title: 'In the Hall of the Mountain King',
  composer: 'Edvard Grieg',
  bpm: 110,
  difficulty: 3,
  notes,
};
