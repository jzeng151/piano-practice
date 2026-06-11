import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseMusicXml, unzipMxl, REJECT_MESSAGE } from './musicxml';
import { SongFormatError } from './types';

const wrap = (measures: string, extra = '') => `<?xml version="1.0"?>
<score-partwise version="3.1">
  <work><work-title>Test Piece</work-title></work>
  <identification><creator type="composer">Tester</creator></identification>
  ${extra}
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;

const ATTRS = '<attributes><divisions>4</divisions></attributes>';
const note = (step: string, octave: number, dur: number, opts = '') =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration>${opts}</note>`;

describe('MusicXML construct contract', () => {
  it('compiles plain notes with correct pitches and timing', () => {
    const xml = wrap(`<measure number="1">${ATTRS}${note('C', 4, 4)}${note('E', 4, 4)}</measure>`);
    const { song } = parseMusicXml(xml, 'id', 'fb');
    expect(song.title).toBe('Test Piece');
    expect(song.composer).toBe('Tester');
    expect(song.notes.map((n) => n.midi)).toEqual([60, 64]);
    expect(song.notes[1].startTick).toBe(480); // divisions 4 → quarter = 480 ticks
  });

  it('handles backup/forward (multi-voice) ordering', () => {
    const xml = wrap(
      `<measure number="1">${ATTRS}${note('C', 5, 8)}<backup><duration>8</duration></backup>${note('C', 4, 4)}${note('D', 4, 4)}</measure>`,
    );
    const { song } = parseMusicXml(xml, 'id', 'fb');
    const at0 = song.notes.filter((n) => n.startTick === 0).map((n) => n.midi).sort();
    expect(at0).toEqual([60, 72]);
    expect(song.notes.find((n) => n.midi === 62)?.startTick).toBe(480);
  });

  it('supports mid-part divisions changes', () => {
    const xml = wrap(
      `<measure number="1">${ATTRS}${note('C', 4, 4)}</measure>
       <measure number="2"><attributes><divisions>8</divisions></attributes>${note('D', 4, 8)}</measure>`,
    );
    const { song } = parseMusicXml(xml, 'id', 'fb');
    // both notes are quarter notes = 480 ticks each
    expect(song.notes[1].startTick).toBe(480);
    expect(song.notes[1].durationTick).toBe(480);
  });

  it('triplets need no special handling — durations carry the timing', () => {
    // triplet eighths: divisions 12, each note duration 4 (a third of a beat... duration 4/12 beat)
    const xml = wrap(
      `<measure number="1"><attributes><divisions>12</divisions></attributes>${note('C', 4, 4)}${note('D', 4, 4)}${note('E', 4, 4)}</measure>`,
    );
    const { song } = parseMusicXml(xml, 'id', 'fb');
    expect(song.notes[1].startTick).toBe(160);
    expect(song.notes[2].startTick).toBe(320);
  });

  it('drops grace notes with a visible warning', () => {
    const xml = wrap(
      `<measure number="1">${ATTRS}<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>${note('C', 4, 4)}</measure>`,
    );
    const { song, warnings } = parseMusicXml(xml, 'id', 'fb');
    expect(song.notes).toHaveLength(1);
    expect(warnings.some((w) => w.kind === 'grace-notes-dropped')).toBe(true);
  });

  it('merges ties into a single long note', () => {
    const xml = wrap(
      `<measure number="1">${ATTRS}${note('C', 4, 8, '<tie type="start"/>')}</measure>
       <measure number="2">${note('C', 4, 8, '<tie type="stop"/>')}</measure>`,
    );
    const { song } = parseMusicXml(xml, 'id', 'fb');
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0].durationTick).toBe(1920);
  });

  it('assigns hands from staves (1=R, 2=L)', () => {
    const xml = wrap(
      `<measure number="1">${ATTRS}${note('C', 5, 4, '<staff>1</staff>')}<backup><duration>4</duration></backup>${note('C', 4, 4, '<staff>2</staff>')}</measure>`,
    );
    const { song } = parseMusicXml(xml, 'id', 'fb');
    expect(song.notes.find((n) => n.midi === 72)?.hand).toBe('R');
    expect(song.notes.find((n) => n.midi === 60)?.hand).toBe('L');
  });

  it('extracts tempo from sound elements', () => {
    const xml = wrap(
      `<measure number="1">${ATTRS}<direction><sound tempo="88"/></direction>${note('C', 4, 4)}</measure>`,
    );
    const { song } = parseMusicXml(xml, 'id', 'fb');
    expect(song.tempoMap[0]).toEqual({ tick: 0, bpm: 88 });
  });

  it('picks the densest part with a warning for multi-part files', () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"/><score-part id="P2"/></part-list>
  <part id="P1"><measure number="1">${ATTRS}${note('C', 4, 4)}</measure></part>
  <part id="P2"><measure number="1">${ATTRS}${note('E', 4, 4)}${note('F', 4, 4)}${note('G', 4, 4)}</measure></part>
</score-partwise>`;
    const { song, warnings } = parseMusicXml(xml, 'id', 'fb');
    expect(song.notes).toHaveLength(3);
    expect(warnings.some((w) => w.kind === 'multi-part')).toBe(true);
  });
});

describe('loud rejections', () => {
  it('rejects repeat barlines with the remediation message', () => {
    const xml = wrap(
      `<measure number="1">${ATTRS}${note('C', 4, 4)}<barline location="right"><repeat direction="backward"/></barline></measure>`,
    );
    expect(() => parseMusicXml(xml, 'id', 'fb')).toThrow(REJECT_MESSAGE);
  });

  it('rejects voltas, segno/coda, and D.C. directions', () => {
    for (const fragment of [
      '<barline><ending number="1" type="start"/></barline>',
      '<direction><direction-type><segno/></direction-type></direction>',
      '<direction><direction-type><words>D.C. al Fine</words></direction-type></direction>',
    ]) {
      const xml = wrap(`<measure number="1">${ATTRS}${note('C', 4, 4)}${fragment}</measure>`);
      expect(() => parseMusicXml(xml, 'id', 'fb')).toThrow(SongFormatError);
    }
  });

  it('rejects transposing-instrument parts', () => {
    const xml = wrap(
      `<measure number="1"><attributes><divisions>4</divisions><transpose><chromatic>-2</chromatic></transpose></attributes>${note('C', 4, 4)}</measure>`,
    );
    expect(() => parseMusicXml(xml, 'id', 'fb')).toThrow(/Transposing/);
  });

  it('rejects timewise scores and non-XML loudly', () => {
    expect(() => parseMusicXml('<score-timewise></score-timewise>', 'id', 'fb')).toThrow(SongFormatError);
    expect(() => parseMusicXml('not xml at all', 'id', 'fb')).toThrow(SongFormatError);
  });

  it('rejects internal DTD subsets (entity tricks)', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE score-partwise [<!ENTITY a "bbbb">]><score-partwise/>`;
    expect(() => parseMusicXml(evil, 'id', 'fb')).toThrow(SongFormatError);
  });
});

describe('.mxl container', () => {
  function mxl(files: Record<string, string>): Uint8Array {
    const input: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(files)) input[k] = strToU8(v);
    return zipSync(input);
  }

  it('unzips via container.xml rootfile discovery', () => {
    const xml = wrap(`<measure number="1">${ATTRS}${note('C', 4, 4)}</measure>`);
    const bytes = mxl({
      'META-INF/container.xml':
        '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
      'score.xml': xml,
    });
    const out = unzipMxl(bytes);
    expect(out).toContain('score-partwise');
  });

  it('rejects archives without container.xml or rootfile', () => {
    expect(() => unzipMxl(mxl({ 'score.xml': '<x/>' }))).toThrow(/container/);
    expect(() =>
      unzipMxl(mxl({ 'META-INF/container.xml': '<container></container>' })),
    ).toThrow(/rootfile/);
    expect(() => unzipMxl(strToU8('PK garbage'))).toThrow(SongFormatError);
  });
});
