import { describe, expect, it } from 'vitest';
import { BUILTINS } from './index';
import { builtinToSong } from './types';
import { compileSong, computeMaxSimultaneity, MAX_SIMULTANEITY, rangeFitsWindow } from '../compile';

// The build-time content gate: every built-in must satisfy the constraints
// the input scheme physically requires. CI fails on any violation.
describe('built-in arrangements', () => {
  it('ships exactly 10 pieces, easiest-first', () => {
    expect(BUILTINS).toHaveLength(10);
    const difficulties = BUILTINS.map((b) => b.difficulty);
    expect([...difficulties].sort((a, b) => a - b)).toEqual(difficulties);
    expect(new Set(BUILTINS.map((b) => b.id)).size).toBe(10);
  });

  for (const def of BUILTINS) {
    describe(def.title, () => {
      const song = builtinToSong(def);

      it('fits one 18-semitone C-aligned window', () => {
        expect(song.playableRange.min).toBeGreaterThanOrEqual(60 + song.baseWindowOffset);
        expect(song.playableRange.max).toBeLessThanOrEqual(77 + song.baseWindowOffset);
        expect(rangeFitsWindow(song)).toBe(true);
      });

      it(`caps simultaneity at ${MAX_SIMULTANEITY}`, () => {
        expect(computeMaxSimultaneity(song.notes)).toBeLessThanOrEqual(MAX_SIMULTANEITY);
      });

      it('has substantial, well-formed content', () => {
        expect(song.notes.length).toBeGreaterThanOrEqual(40);
        for (const n of song.notes) {
          expect(n.durationTick).toBeGreaterThan(0);
          expect(n.startTick).toBeGreaterThanOrEqual(0);
        }
        const compiled = compileSong(song);
        expect(compiled.groups.length).toBeGreaterThan(10);
        expect(compiled.durationSec).toBeGreaterThan(15);
      });

      it('carries hand data for per-hand practice', () => {
        expect(song.notes.some((n) => n.hand === 'L')).toBe(true);
        expect(song.notes.some((n) => n.hand === 'R')).toBe(true);
      });
    });
  }
});
