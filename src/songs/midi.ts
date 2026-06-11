import { Midi } from '@tonejs/midi';
import type { Hand, PedalEvent, PracticeSong, SongNote, TempoEvent } from './types';
import { SongFormatError } from './types';
import { withDerived } from './compile';

/**
 * Parse a .mid/.midi file into a PracticeSong.
 * Hand assignment is deterministic: exactly two note-bearing tracks → the
 * lower-average-pitch track is L; anything else → 'unknown'.
 */
export function parseMidi(bytes: Uint8Array, id: string, title: string): PracticeSong {
  let midi: Midi;
  try {
    midi = new Midi(bytes);
  } catch {
    throw new SongFormatError("This MIDI file couldn't be read");
  }
  const ppq = midi.header.ppq;
  if (!ppq || ppq <= 0) {
    throw new SongFormatError('Invalid PPQ (SMPTE time division is not supported)');
  }

  const noteTracks = midi.tracks.filter((t) => t.notes.length > 0);
  if (noteTracks.length === 0) throw new SongFormatError('File contains no playable notes');

  let handForTrack: (i: number) => Hand = () => 'unknown';
  if (noteTracks.length === 2) {
    const avg = (t: (typeof noteTracks)[number]) =>
      t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length;
    const lower = avg(noteTracks[0]) <= avg(noteTracks[1]) ? 0 : 1;
    handForTrack = (i) => (i === lower ? 'L' : 'R');
  }

  const notes: SongNote[] = [];
  noteTracks.forEach((t, i) => {
    const hand = handForTrack(i);
    for (const n of t.notes) {
      notes.push({
        startTick: n.ticks,
        durationTick: n.durationTicks,
        midi: n.midi,
        hand,
        velocity: Math.round(n.velocity * 127),
      });
    }
  });

  const tempoMap: TempoEvent[] = midi.header.tempos.map((t) => ({
    tick: t.ticks,
    bpm: t.bpm,
  }));

  const pedalEvents: PedalEvent[] = [];
  for (const t of midi.tracks) {
    const cc64 = t.controlChanges[64] ?? [];
    for (const e of cc64) {
      pedalEvents.push({ tick: e.ticks, down: e.value >= 0.5 });
    }
  }
  pedalEvents.sort((a, b) => a.tick - b.tick);

  return withDerived({
    id,
    title: title || midi.name || 'Untitled',
    composer: '',
    source: 'midi',
    ppq,
    tempoMap,
    notes,
    pedalEvents,
    playableRange: { min: 0, max: 0 },
    maxSimultaneity: 0,
    baseWindowOffset: 0,
  });
}
