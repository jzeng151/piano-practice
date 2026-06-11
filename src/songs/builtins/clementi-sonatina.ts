import type { BuiltinDef } from './types';

// Clementi — Sonatina Op. 36 No. 1, mvt 1 opening, transposed to B-flat so
// the scale runs crest at F5 inside the window. 4/4, difficulty 3: the
// eighth-note passage work is the speed test of the library. Alberti bass
// simplified to broken two-note figures.
const C4 = 60, D4 = 62, Eb4 = 63, F4 = 65, G4 = 67, A4 = 69, Bb4 = 70, C5 = 72, D5 = 74, Eb5 = 75, F5 = 77;

const notes: BuiltinDef['notes'] = [];
let bar = 0;
const R = (beat: number, dur: number, midi: number) => notes.push([bar * 4 + beat, dur, midi, 'R']);
const L = (beat: number, dur: number, midi: number) => notes.push([bar * 4 + beat, dur, midi, 'L']);
const next = () => bar++;
/** Broken LH figure: root–fifth eighths across the bar. */
const alberti = (root: number, fifth: number) => {
  for (let q = 0; q < 4; q++) {
    L(q, 0.5, q % 2 === 0 ? root : fifth);
  }
};

// Theme: Bb4 D5 Bb4 F4 (the fanfare), twice
alberti(D4, F4); R(0, 1, Bb4); R(1, 1, D5); R(2, 1, Bb4); R(3, 1, F4); next();
alberti(D4, F4); R(0, 2, G4); R(2, 2, F4); next();
alberti(C4, Eb4); R(0, 1, C5); R(1, 1, Eb5); R(2, 1, C5); R(3, 1, F4); next();
alberti(D4, F4); R(0, 2, Bb4); R(2, 2, A4); next();
// Scale run up and down (eighths): Bb4 C5 D5 Eb5 F5 Eb5 D5 C5
alberti(D4, F4);
[Bb4, C5, D5, Eb5, F5, Eb5, D5, C5].forEach((m, i) => R(i * 0.5, 0.5, m));
next();
alberti(C4, Eb4);
[D5, C5, Bb4, A4, Bb4, C5, A4, F4].forEach((m, i) => R(i * 0.5, 0.5, m));
next();
alberti(D4, F4); R(0, 1, Bb4); R(1, 1, D5); R(2, 1, Bb4); R(3, 1, F4); next();
alberti(C4, F4); R(0, 2, A4); R(2, 2, C5); next();
// Development figure: descending sequence in eighths
alberti(C4, Eb4);
[F5, Eb5, D5, C5, D5, C5, Bb4, A4].forEach((m, i) => R(i * 0.5, 0.5, m));
next();
alberti(D4, F4);
[Bb4, A4, G4, F4, G4, A4, Bb4, C5].forEach((m, i) => R(i * 0.5, 0.5, m));
next();
// Recap of the fanfare and close
alberti(D4, F4); R(0, 1, Bb4); R(1, 1, D5); R(2, 1, Bb4); R(3, 1, F4); next();
alberti(C4, F4); R(0, 1, A4); R(1, 1, C5); R(2, 2, Bb4); next();
L(0, 4, D4); L(0, 4, F4); R(0, 4, Bb4); next();

export const clementiSonatina: BuiltinDef = {
  id: 'builtin-clementi-sonatina',
  title: 'Sonatina Op. 36 No. 1 (opening)',
  composer: 'Muzio Clementi',
  bpm: 132,
  difficulty: 3,
  notes,
};
