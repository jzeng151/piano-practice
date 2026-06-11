import { describe, expect, it } from 'vitest';
import { Scorer, SCORE_WINDOW_REAL_SEC } from './scorer';
import { compileSong, withDerived } from '../songs/compile';
import type { SongNote } from '../songs/types';

const PPQ = 480;
const N = (startBeat: number, midi: number): SongNote => ({
  startTick: startBeat * PPQ,
  durationTick: PPQ,
  midi,
  hand: 'unknown',
  velocity: 90,
});

function makeScorer(notes: SongNote[], speed = 1) {
  const compiled = compileSong(
    withDerived({
      id: 't', title: 't', composer: '', source: 'midi', ppq: PPQ,
      tempoMap: [{ tick: 0, bpm: 120 }],
      notes, pedalEvents: [],
      playableRange: { min: 0, max: 0 }, maxSimultaneity: 0, baseWindowOffset: 0,
    }),
  );
  return new Scorer(compiled, 'both', speed);
}

describe('scorer matching', () => {
  it('one press consumes at most one note; one note consumed by one press', () => {
    const s = makeScorer([N(0, 60)]);
    expect(s.press(60, 0)).toBe('hit');
    expect(s.press(60, 0.01)).toBe('wrong'); // already consumed
  });

  it('greedy nearest-unconsumed among repeated pitches in the window', () => {
    // two C's 200ms apart (0.4 beats at 120bpm = 0.2s)
    const s = makeScorer([N(0, 60), N(0.4, 60)]);
    expect(s.press(60, 0.19)).toBe('hit'); // nearest is the second note (0.2s)
    expect(s.press(60, 0.01)).toBe('hit'); // first note still available
    expect(s.getCounts().hit).toBe(2);
  });

  it('window is REAL time — scales with playback speed in song seconds', () => {
    const half = makeScorer([N(0, 60)], 0.5);
    // ±150ms real at 0.5x = ±75ms song time
    expect(half.press(60, 0.08)).toBe('wrong');
    const full = makeScorer([N(0, 60)], 1);
    expect(full.press(60, 0.08)).not.toBe('wrong');
  });

  it('judgments split hit/early/late and misses close after the window', () => {
    const s = makeScorer([N(0, 60), N(1, 62)]);
    expect(s.press(60, -0.1)).toBe('early');
    s.advance(0.5 + SCORE_WINDOW_REAL_SEC + 0.01);
    expect(s.getCounts().miss).toBe(1);
    expect(s.done(0.7)).toBe(true);
  });

  it('resetWindow re-arms targets for A-B loops without corrupting counts', () => {
    const s = makeScorer([N(0, 60)]);
    s.press(60, 0);
    expect(s.getCounts().hit).toBe(1);
    s.resetWindow(0, 10);
    expect(s.getCounts().hit).toBe(0);
    expect(s.press(60, 0)).toBe('hit');
  });
});
