import { describe, expect, it } from 'vitest';
import {
  buildTempoSegments,
  tickToSec,
  compileSong,
  computeMaxSimultaneity,
  findWindowBase,
  foldToWindow,
  normalizeNotes,
  withDerived,
  GROUP_EPSILON_SEC,
} from './compile';
import { SongFormatError, type PracticeSong, type SongNote } from './types';

const PPQ = 480;

function song(notes: SongNote[], tempoMap = [{ tick: 0, bpm: 120 }]): PracticeSong {
  return withDerived({
    id: 't',
    title: 't',
    composer: '',
    source: 'midi',
    ppq: PPQ,
    tempoMap,
    notes,
    pedalEvents: [],
    playableRange: { min: 0, max: 0 },
    maxSimultaneity: 0,
    baseWindowOffset: 0,
  });
}

const N = (startTick: number, durationTick: number, midi: number): SongNote => ({
  startTick,
  durationTick,
  midi,
  hand: 'unknown',
  velocity: 90,
});

describe('tempo map', () => {
  it('defaults to 120 BPM when no event at tick 0', () => {
    const segs = buildTempoSegments([{ tick: 960, bpm: 60 }], PPQ);
    // first beat at 120 BPM = 0.5s per beat
    expect(tickToSec(480, segs, PPQ)).toBeCloseTo(0.5);
    // after tick 960 (1s), 60 BPM = 1s per beat
    expect(tickToSec(1440, segs, PPQ)).toBeCloseTo(2);
  });

  it('last-wins for same-tick tempo events', () => {
    const segs = buildTempoSegments(
      [
        { tick: 0, bpm: 240 },
        { tick: 0, bpm: 120 },
      ],
      PPQ,
    );
    expect(tickToSec(480, segs, PPQ)).toBeCloseTo(0.5);
  });

  it('rejects invalid BPM and SMPTE-like PPQ loudly', () => {
    expect(() => buildTempoSegments([{ tick: 0, bpm: -5 }], PPQ)).toThrow(SongFormatError);
    expect(() => buildTempoSegments([], -480)).toThrow(SongFormatError);
  });

  it('integrates durations ACROSS a tempo boundary', () => {
    // note spans tick 0..960; tempo doubles at tick 480
    const s = song([N(0, 960, 60)], [
      { tick: 0, bpm: 120 }, // 480 ticks = 0.5s
      { tick: 480, bpm: 60 }, // 480 ticks = 1.0s
    ]);
    const compiled = compileSong(s);
    expect(compiled.groups[0].notes[0].durationSec).toBeCloseTo(1.5);
  });
});

describe('note grouping', () => {
  it('coalesces humanized chord onsets within the epsilon into one group', () => {
    const jitterTicks = Math.round((GROUP_EPSILON_SEC / 2) * 2 * PPQ); // ~epsilon at 120bpm: 0.04s = 38.4 ticks
    const s = song([N(0, 480, 60), N(jitterTicks, 480, 64), N(960, 480, 67)]);
    const compiled = compileSong(s);
    expect(compiled.groups).toHaveLength(2);
    expect(compiled.groups[0].notes.map((n) => n.midi).sort()).toEqual([60, 64]);
  });

  it('dedupes unisons within a group, keeping the longer duration', () => {
    const s = song([N(0, 240, 60), N(0, 480, 60)]);
    const compiled = compileSong(s);
    expect(compiled.groups[0].notes).toHaveLength(1);
    expect(compiled.groups[0].notes[0].durationSec).toBeCloseTo(0.5);
  });
});

describe('normalization', () => {
  it('truncates overlapping same-pitch notes at the next onset', () => {
    const out = normalizeNotes([N(0, 960, 60), N(480, 480, 60)]);
    expect(out[0].durationTick).toBe(480);
  });

  it('drops zero/negative-duration notes', () => {
    expect(normalizeNotes([N(0, 0, 60), N(0, -5, 62)])).toHaveLength(0);
  });
});

describe('simultaneity (sweep line)', () => {
  it('a note ending at t does not overlap one starting at t', () => {
    expect(computeMaxSimultaneity([N(0, 480, 60), N(480, 480, 62)])).toBe(1);
  });

  it('counts true overlaps', () => {
    expect(
      computeMaxSimultaneity([N(0, 960, 60), N(0, 960, 64), N(480, 960, 67), N(480, 960, 71)]),
    ).toBe(4);
  });
});

describe('window fitting', () => {
  it('finds a C-aligned window for an in-span range', () => {
    expect(findWindowBase(62, 76)).toBe(60);
    expect(findWindowBase(48, 65)).toBe(48);
  });

  it('returns null when the span exceeds 18 semitones', () => {
    expect(findWindowBase(48, 80)).toBeNull();
  });

  it('foldToWindow brings outliers inside by octaves', () => {
    const { notes, folded } = foldToWindow([N(0, 480, 40), N(0, 480, 90), N(0, 480, 65)], 60);
    expect(folded).toBe(2);
    for (const n of notes) {
      expect(n.midi).toBeGreaterThanOrEqual(60);
      expect(n.midi).toBeLessThanOrEqual(77);
    }
  });

  it('withDerived computes a C-aligned baseWindowOffset', () => {
    const s = song([N(0, 480, 48), N(0, 480, 55)]);
    expect(s.baseWindowOffset).toBe(-12);
  });
});

describe('compile errors', () => {
  it('rejects empty songs loudly', () => {
    expect(() =>
      compileSong({
        id: 't',
        title: 't',
        composer: '',
        source: 'midi',
        ppq: PPQ,
        tempoMap: [],
        notes: [],
        pedalEvents: [],
        playableRange: { min: 0, max: 0 },
        maxSimultaneity: 0,
        baseWindowOffset: 0,
      }),
    ).toThrow(SongFormatError);
  });
});
