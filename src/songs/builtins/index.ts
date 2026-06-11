import type { BuiltinDef } from './types';
import { brahmsLullaby } from './brahms-lullaby';
import { canonInD } from './canon-in-d';
import { clementiSonatina } from './clementi-sonatina';
import { furElise } from './fur-elise';
import { gymnopedie1 } from './gymnopedie-1';
import { minuetInG } from './minuet-in-g';
import { mountainKing } from './mountain-king';
import { odeToJoy } from './ode-to-joy';
import { preludeInC } from './prelude-in-c';
import { swanLake } from './swan-lake';

// Easiest-first (ties: alphabetical by title). Display order — the
// arrange-hardest-first rule was a build/spike concern, never this order.
export const BUILTINS: BuiltinDef[] = [
  canonInD,
  brahmsLullaby,
  minuetInG,
  odeToJoy,
  furElise,
  gymnopedie1,
  preludeInC,
  swanLake,
  clementiSonatina,
  mountainKing,
];
