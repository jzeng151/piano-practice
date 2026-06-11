import { describe, expect, it } from 'vitest';
import { Engine, LEAD_IN_REAL_SEC, type EngineAudio, type EngineOptions } from './clock';
import { compileSong } from '../songs/compile';
import { withDerived } from '../songs/compile';
import type { PracticeSong, SongNote } from '../songs/types';

const PPQ = 480;

function makeSong(notes: SongNote[]): PracticeSong {
  return withDerived({
    id: 't',
    title: 't',
    composer: '',
    source: 'midi',
    ppq: PPQ,
    tempoMap: [{ tick: 0, bpm: 120 }], // 1 beat = 0.5s
    notes,
    pedalEvents: [],
    playableRange: { min: 0, max: 0 },
    maxSimultaneity: 0,
    baseWindowOffset: 0,
  });
}

const N = (startBeat: number, durBeats: number, midi: number, hand: SongNote['hand'] = 'unknown'): SongNote => ({
  startTick: startBeat * PPQ,
  durationTick: durBeats * PPQ,
  midi,
  hand,
  velocity: 90,
});

function fakeAudio() {
  const played: number[] = [];
  const clicks: boolean[] = [];
  const audio: EngineAudio = {
    noteOn: (m) => played.push(m),
    noteOff: () => undefined,
    pedal: () => undefined,
    click: (a) => clicks.push(a),
    panic: () => undefined,
  };
  return { audio, played, clicks };
}

function makeEngine(notes: SongNote[], opts: Partial<EngineOptions> = {}) {
  const { audio, played, clicks } = fakeAudio();
  const engine = new Engine({
    compiled: compileSong(makeSong(notes)),
    mode: 'wait',
    speed: 1,
    hands: 'both',
    countIn: false,
    audio,
    ...opts,
  });
  return { engine, played, clicks };
}

/** Drive the engine from t=0 in small steps up to `untilMs`. */
function run(engine: Engine, fromMs: number, untilMs: number, step = 16) {
  for (let t = fromMs; t <= untilMs; t += step) engine.tick(t);
}

const press = (engine: Engine, midi: number, t = 0) =>
  engine.handleInput({ type: 'note', on: true, midi, velocity: 90, timestamp: t });
const release = (engine: Engine, midi: number, t = 0) =>
  engine.handleInput({ type: 'note', on: false, midi, velocity: 0, timestamp: t });
const pedal = (engine: Engine, down: boolean, t = 0) =>
  engine.handleInput({ type: 'pedal', down, timestamp: t });

const LEAD_MS = LEAD_IN_REAL_SEC * 1000;

describe('wait-mode gate v2', () => {
  it('repeated notes require fresh strikes — holding never advances', () => {
    // E, then E again (Für Elise case)
    const { engine } = makeEngine([N(0, 1, 76), N(1, 1, 76)]);
    engine.start();
    run(engine, 0, LEAD_MS + 50);
    expect(engine.getSnapshot().state).toBe('waiting');

    press(engine, 76);
    // gate 1 opens; KEEP HOLDING through gate 2's arm
    run(engine, LEAD_MS + 50, LEAD_MS + 1600);
    expect(engine.getSnapshot().state).toBe('waiting'); // must NOT auto-pass
    expect(engine.getSnapshot().gatingGroup).toBe(1);

    // fresh strike opens it
    release(engine, 76);
    press(engine, 76);
    run(engine, LEAD_MS + 1600, LEAD_MS + 3000);
    expect(engine.getSnapshot().state).toBe('finished');
  });

  it('a rolled chord with the pedal down satisfies a chord gate', () => {
    const { engine } = makeEngine([N(0, 1, 60), N(0, 1, 64), N(0, 1, 67)]);
    engine.start();
    run(engine, 0, LEAD_MS + 50);
    expect(engine.getSnapshot().state).toBe('waiting');

    pedal(engine, true);
    press(engine, 60);
    release(engine, 60); // ghosting keyboard: can't hold all three
    press(engine, 64);
    release(engine, 64);
    press(engine, 67);
    run(engine, LEAD_MS + 50, LEAD_MS + 2000);
    expect(engine.getSnapshot().state).toBe('finished');
  });

  it('wrong keys sound the caller path but never block the gate', () => {
    const { engine } = makeEngine([N(0, 1, 60)]);
    engine.start();
    run(engine, 0, LEAD_MS + 50);
    press(engine, 65); // wrong
    expect(engine.getSnapshot().wrongPresses).toBe(1);
    expect(engine.getSnapshot().state).toBe('waiting');
    press(engine, 60); // right, while wrong key still held
    run(engine, LEAD_MS + 50, LEAD_MS + 1200);
    expect(engine.getSnapshot().state).toBe('finished');
  });
});

describe('transport', () => {
  it('freezes song time while waiting (unbounded gate)', () => {
    const { engine } = makeEngine([N(0, 1, 60), N(4, 1, 62)]);
    engine.start();
    run(engine, 0, LEAD_MS + 50);
    const t1 = engine.getSnapshot().songTime;
    run(engine, LEAD_MS + 50, LEAD_MS + 60_000); // a minute at the gate
    expect(engine.getSnapshot().songTime).toBe(t1);
  });

  it('pause freezes and resume continues without a jump', () => {
    const { engine } = makeEngine([N(2, 1, 60)], { mode: 'scroll' });
    engine.start();
    run(engine, 0, LEAD_MS + 200);
    engine.pause();
    const t1 = engine.getSnapshot().songTime;
    run(engine, LEAD_MS + 200, LEAD_MS + 5000); // ticks while paused
    expect(engine.getSnapshot().songTime).toBe(t1);
    engine.resume();
    run(engine, LEAD_MS + 5000, LEAD_MS + 5100);
    expect(engine.getSnapshot().songTime).toBeGreaterThan(t1);
    expect(engine.getSnapshot().songTime).toBeLessThan(t1 + 0.5);
  });

  it('applies the 2s lead-in before the first note in wait mode too', () => {
    const { engine } = makeEngine([N(0, 1, 60)]);
    engine.start();
    expect(engine.getSnapshot().songTime).toBeCloseTo(-LEAD_IN_REAL_SEC, 1);
  });

  it('half speed scales the clock, not the data', () => {
    const { engine } = makeEngine([N(2, 1, 60)], { mode: 'scroll', speed: 0.5 });
    engine.start();
    run(engine, 0, 1000);
    // 1s real at 0.5x = 0.5 song-sec progressed (starting from -lead*speed)
    expect(engine.getSnapshot().songTime).toBeCloseTo(-LEAD_IN_REAL_SEC * 0.5 + 0.5, 1);
  });
});

describe('count-in', () => {
  it('plays 4 clicks before scroll playback, accented first', () => {
    const { engine, clicks } = makeEngine([N(0, 1, 60)], { mode: 'scroll', countIn: true });
    engine.start();
    run(engine, 0, LEAD_MS + 100);
    expect(clicks).toHaveLength(4);
    expect(clicks[0]).toBe(true);
    expect(clicks.slice(1)).toEqual([false, false, false]);
  });
});

describe('A-B loop', () => {
  it('wraps from B back to A in scroll mode and re-scores the window', () => {
    const { engine } = makeEngine([N(0, 1, 60), N(2, 1, 62), N(6, 1, 64)], { mode: 'scroll' });
    engine.start();
    engine.setLoop(0, 3);
    run(engine, 0, LEAD_MS + 3500);
    const t = engine.getSnapshot().songTime;
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(3);
  });

  // NOTE: beats at 120 BPM = startBeat × 0.5 song-seconds; gates below sit at
  // song-sec 0 and 1.5. Loop markers are in song-seconds.
  it('wraps in wait mode when B sits at/before a gate start (review F1)', () => {
    const { engine } = makeEngine([N(0, 1, 60), N(3, 1, 62)]); // gates at 0s, 1.5s
    engine.start();
    run(engine, 0, LEAD_MS + 50);
    press(engine, 60);
    release(engine, 60);
    engine.setLoop(0.25, 1.5); // B exactly at the second gate's start
    // without the wrap-before-gate fix the engine clamps at the gate forever
    run(engine, LEAD_MS + 50, LEAD_MS + 8000);
    const s = engine.getSnapshot();
    expect(s.songTime).toBeLessThan(1.5);
    expect(s.gatingGroup).not.toBe(1); // never armed the post-B gate
  });

  it('wrapping into a chord the user still holds requires fresh strikes (review F2)', () => {
    const { engine } = makeEngine([N(0, 1, 60), N(2, 1, 62)]); // gates at 0s, 1.0s
    engine.start();
    run(engine, 0, LEAD_MS + 50);
    press(engine, 60); // opens gate 0, KEEP HOLDING
    engine.setLoop(0, 0.8); // wrap before the second gate
    // loop wraps back across gate 0; the still-held key must not
    // auto-satisfy the re-armed gate
    run(engine, LEAD_MS + 50, LEAD_MS + 6000);
    expect(engine.getSnapshot().state).toBe('waiting');
    expect(engine.getSnapshot().gatingGroup).toBe(0);
    expect(engine.getSnapshot().satisfied.size).toBe(0);
    // fresh strike opens it again
    release(engine, 60);
    press(engine, 60);
    run(engine, LEAD_MS + 6000, LEAD_MS + 6064);
    expect(['playing', 'waiting']).toContain(engine.getSnapshot().state);
    expect(engine.getSnapshot().songTime).toBeGreaterThan(0);
  });

  it('wrapping while a gate is armed returns to playing (no stranded wait)', () => {
    const { engine } = makeEngine([N(0, 1, 60), N(2.9, 1, 62)]);
    engine.start();
    run(engine, 0, LEAD_MS + 50);
    press(engine, 60);
    release(engine, 60);
    engine.setLoop(0, 2.95);
    // run until the second gate arms at 2.9 then the loop wraps at 2.95
    run(engine, LEAD_MS + 50, LEAD_MS + 4000);
    const s = engine.getSnapshot();
    expect(['playing', 'waiting']).toContain(s.state);
    expect(s.songTime).toBeLessThan(3);
  });
});

describe('per-hand practice', () => {
  it('auto-plays the muted hand and gates only on the played hand', () => {
    const { engine, played } = makeEngine(
      [N(0, 1, 48, 'L'), N(0, 1, 72, 'R'), N(1, 1, 50, 'L')],
      { hands: 'R' },
    );
    engine.start();
    run(engine, 0, LEAD_MS + 50);
    expect(engine.getSnapshot().state).toBe('waiting');
    press(engine, 72); // only the R note is required
    run(engine, LEAD_MS + 50, LEAD_MS + 50 + 16);
    expect(played).toContain(48); // muted-hand note fired when the gate opened
    // the L-only group at beat 1 is not a gate: it auto-plays in passing
    run(engine, LEAD_MS + 66, LEAD_MS + 2500);
    expect(played).toContain(50);
    expect(engine.getSnapshot().state).toBe('finished');
  });
});

describe('scroll scoring integration', () => {
  it('judges a press at the right moment as a hit and finishes with done()', () => {
    const { engine } = makeEngine([N(0, 1, 60)], { mode: 'scroll' });
    engine.start();
    run(engine, 0, LEAD_MS); // songTime ≈ 0 — the note is at the hit line
    press(engine, 60);
    expect(engine.getSnapshot().counts.hit + engine.getSnapshot().counts.early + engine.getSnapshot().counts.late).toBe(1);
    run(engine, LEAD_MS, LEAD_MS + 2000);
    expect(engine.getSnapshot().state).toBe('finished');
    expect(engine.getSnapshot().accuracy).toBe(1);
  });

  it('an unplayed note becomes a miss', () => {
    const { engine } = makeEngine([N(0, 1, 60)], { mode: 'scroll' });
    engine.start();
    run(engine, 0, LEAD_MS + 2000);
    expect(engine.getSnapshot().counts.miss).toBe(1);
    expect(engine.getSnapshot().state).toBe('finished');
  });
});
