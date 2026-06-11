import type {
  CompiledSong,
  NoteGroup,
  PracticeSong,
  SongNote,
  TempoEvent,
} from './types';
import { SongFormatError } from './types';
import { WINDOW_BASE_MIN, WINDOW_BASE_MAX_C, WINDOW_SPAN, DEFAULT_WINDOW_BASE } from '../input/keyboard';

export const GROUP_EPSILON_SEC = 0.04; // NoteGroup onset epsilon (40 ms)
export const MIN_DURATION_SEC = 0.06;
export const MAX_SIMULTANEITY = 4;
const DEFAULT_BPM = 120;

interface TempoSegment {
  tick: number;
  bpm: number;
  startSec: number;
}

/**
 * Build cumulative tempo segments. Contract: default 120 BPM when no event at
 * tick 0; last-wins for same-tick events; invalid BPM rejected loudly.
 */
export function buildTempoSegments(tempoMap: TempoEvent[], ppq: number): TempoSegment[] {
  if (ppq <= 0) throw new SongFormatError('Invalid PPQ (SMPTE time division is not supported)');
  const events = [...tempoMap]
    .filter((e) => e.tick >= 0)
    .sort((a, b) => a.tick - b.tick);
  for (const e of events) {
    if (!Number.isFinite(e.bpm) || e.bpm <= 0 || e.bpm > 1000) {
      throw new SongFormatError(`Invalid tempo: ${e.bpm} BPM`);
    }
  }
  // last-wins for duplicate ticks
  const dedup: TempoEvent[] = [];
  for (const e of events) {
    if (dedup.length > 0 && dedup[dedup.length - 1].tick === e.tick) {
      dedup[dedup.length - 1] = e;
    } else {
      dedup.push(e);
    }
  }
  if (dedup.length === 0 || dedup[0].tick > 0) {
    dedup.unshift({ tick: 0, bpm: DEFAULT_BPM });
  }
  const segments: TempoSegment[] = [];
  let sec = 0;
  for (let i = 0; i < dedup.length; i++) {
    segments.push({ tick: dedup[i].tick, bpm: dedup[i].bpm, startSec: sec });
    if (i + 1 < dedup.length) {
      const dt = dedup[i + 1].tick - dedup[i].tick;
      sec += (dt / ppq) * (60 / dedup[i].bpm);
    }
  }
  return segments;
}

/** Tick → seconds, integrating across tempo segments. */
export function tickToSec(tick: number, segments: TempoSegment[], ppq: number): number {
  let seg = segments[0];
  for (const s of segments) {
    if (s.tick <= tick) seg = s;
    else break;
  }
  return seg.startSec + ((tick - seg.tick) / ppq) * (60 / seg.bpm);
}

/**
 * Sweep-line max simultaneity: a note ending at tick t does not overlap a
 * note starting at t (ends sort before starts at equal tick).
 */
export function computeMaxSimultaneity(notes: SongNote[]): number {
  const events: { tick: number; delta: number }[] = [];
  for (const n of notes) {
    events.push({ tick: n.startTick, delta: 1 });
    events.push({ tick: n.startTick + n.durationTick, delta: -1 });
  }
  events.sort((a, b) => a.tick - b.tick || a.delta - b.delta);
  let cur = 0;
  let max = 0;
  for (const e of events) {
    cur += e.delta;
    if (cur > max) max = cur;
  }
  return max;
}

/**
 * Choose the C-aligned window base whose [base, base+17] covers the song's
 * range, preferring the one centered on the range. Returns null if no single
 * window fits (span > 18 semitones).
 */
export function findWindowBase(min: number, max: number): number | null {
  if (max - min + 1 > WINDOW_SPAN) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (let base = WINDOW_BASE_MIN; base <= WINDOW_BASE_MAX_C; base += 12) {
    if (min >= base && max <= base + WINDOW_SPAN - 1) {
      const dist = Math.abs((min + max) / 2 - (base + (WINDOW_SPAN - 1) / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = base;
      }
    }
  }
  return best;
}

/**
 * Fold out-of-window notes by octaves into [base, base+17].
 * Used when the user accepts the importer's octave-fold offer.
 */
export function foldToWindow(notes: SongNote[], base: number): { notes: SongNote[]; folded: number } {
  let folded = 0;
  const out = notes.map((n) => {
    let midi = n.midi;
    if (midi < base || midi > base + WINDOW_SPAN - 1) {
      folded++;
      while (midi < base) midi += 12;
      while (midi > base + WINDOW_SPAN - 1) midi -= 12;
    }
    return midi === n.midi ? n : { ...n, midi };
  });
  return { notes: out, folded };
}

/**
 * Normalize raw parsed notes:
 * - drop zero/negative durations below a minimum tick length? No: clamp at
 *   the seconds level (compile); at tick level we drop only degenerate notes.
 * - truncate overlapping same-pitch notes at the next onset
 * - performed deterministically (sorted by startTick, then midi)
 */
export function normalizeNotes(notes: SongNote[]): SongNote[] {
  const sorted = [...notes]
    .filter((n) => n.durationTick > 0 && n.midi >= 0 && n.midi <= 127)
    .sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
  // truncate same-pitch overlaps at next onset
  const lastByPitch = new Map<number, SongNote>();
  const out: SongNote[] = [];
  for (const n of sorted) {
    const prev = lastByPitch.get(n.midi);
    if (prev && prev.startTick + prev.durationTick > n.startTick) {
      const idx = out.indexOf(prev);
      const truncated = { ...prev, durationTick: Math.max(1, n.startTick - prev.startTick) };
      if (truncated.startTick === n.startTick) {
        // exact unison duplicate onset — drop the earlier one
        out.splice(idx, 1);
      } else {
        out[idx] = truncated;
      }
    }
    out.push({ ...n });
    lastByPitch.set(n.midi, out[out.length - 1]);
  }
  return out;
}

/**
 * Compile a PracticeSong into the NoteGroup timeline both guide modes consume.
 * Coalescing happens HERE (onset epsilon), never in the input layer.
 */
export function compileSong(song: PracticeSong): CompiledSong {
  const segments = buildTempoSegments(song.tempoMap, song.ppq);
  const normalized = normalizeNotes(song.notes);
  if (normalized.length === 0) throw new SongFormatError('File contains no playable notes');

  interface TimedNote {
    startSec: number;
    durationSec: number;
    midi: number;
    hand: SongNote['hand'];
    velocity: number;
  }
  const timed: TimedNote[] = normalized.map((n) => {
    const startSec = tickToSec(n.startTick, segments, song.ppq);
    const endSec = tickToSec(n.startTick + n.durationTick, segments, song.ppq);
    return {
      startSec,
      durationSec: Math.max(MIN_DURATION_SEC, endSec - startSec),
      midi: n.midi,
      hand: n.hand,
      velocity: n.velocity,
    };
  });
  timed.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi);

  const groups: NoteGroup[] = [];
  for (const n of timed) {
    const last = groups[groups.length - 1];
    if (last && n.startSec - last.startSec <= GROUP_EPSILON_SEC) {
      // unison dedupe within a group: keep the longer duration
      const dup = last.notes.find((g) => g.midi === n.midi);
      if (dup) {
        dup.durationSec = Math.max(dup.durationSec, n.durationSec);
      } else {
        last.notes.push({ midi: n.midi, durationSec: n.durationSec, hand: n.hand, velocity: n.velocity });
      }
    } else {
      groups.push({
        startSec: n.startSec,
        notes: [{ midi: n.midi, durationSec: n.durationSec, hand: n.hand, velocity: n.velocity }],
      });
    }
  }

  let durationSec = 0;
  for (const g of groups) {
    for (const n of g.notes) durationSec = Math.max(durationSec, g.startSec + n.durationSec);
  }

  return { song, groups, durationSec };
}

/** Recompute the derived fields after any transform (fold/thin re-validation). */
export function withDerived(song: PracticeSong): PracticeSong {
  const normalized = normalizeNotes(song.notes);
  if (normalized.length === 0) throw new SongFormatError('File contains no playable notes');
  let min = 127;
  let max = 0;
  for (const n of normalized) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
  }
  const base = findWindowBase(min, max);
  return {
    ...song,
    notes: normalized,
    playableRange: { min, max },
    maxSimultaneity: computeMaxSimultaneity(normalized),
    baseWindowOffset: base !== null ? base - DEFAULT_WINDOW_BASE : 0,
  };
}

export function rangeFitsWindow(song: PracticeSong): boolean {
  return findWindowBase(song.playableRange.min, song.playableRange.max) !== null;
}
