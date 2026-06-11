import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { parseInWorker } from '../songs/importClient';
import { contentHash, getSong, putSong, storageAvailable, SCHEMA_VERSION, COMPILER_VERSION, type StoredSong } from '../storage/db';
import { exportBackup, restoreBackup, type RestoreResult } from '../storage/export';
import { foldToWindow, withDerived, rangeFitsWindow, findWindowBase, MAX_SIMULTANEITY } from '../songs/compile';
import { WINDOW_SPAN, midiToName, DEFAULT_WINDOW_BASE } from '../input/keyboard';
import { SongFormatError, type ImportWarning, type PracticeSong } from '../songs/types';

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing'; name: string }
  | { kind: 'range-offer'; pendingRecord: PendingRecord }
  | { kind: 'simultaneity-offer'; pendingRecord: PendingRecord }
  | { kind: 'success'; record: StoredSong }
  | { kind: 'duplicate'; name: string }
  | { kind: 'error'; name: string; message: string };

interface PendingRecord {
  song: PracticeSong;
  warnings: ImportWarning[];
  bytes: ArrayBuffer;
  name: string;
}

export default function Import() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [storageOk, setStorageOk] = useState<boolean | null>(null);
  const [restore, setRestore] = useState<RestoreResult | null>(null);
  const [exportNotice, setExportNotice] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const backupRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    storageAvailable().then(setStorageOk);
  }, []);

  const store = useCallback(async (p: PendingRecord, extraWarnings: ImportWarning[] = []) => {
    const record: StoredSong = {
      id: p.song.id,
      schemaVersion: SCHEMA_VERSION,
      compilerVersion: COMPILER_VERSION,
      song: p.song,
      originalBytes: p.bytes,
      originalName: p.name,
      warnings: [...p.warnings, ...extraWarnings],
      importedAt: Date.now(),
    };
    await putSong(record);
    setExportNotice(true);
    setStage({ kind: 'success', record });
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setRestore(null);
    setStage({ kind: 'parsing', name: file.name });
    try {
      const bytes = await file.arrayBuffer();
      const id = await contentHash(bytes);
      if (await getSong(id)) {
        setStage({ kind: 'duplicate', name: file.name });
        return;
      }
      // transferable — keep a copy for storage
      const keep = bytes.slice(0);
      const { song, warnings } = await parseInWorker(bytes, file.name, id);
      const pendingRecord: PendingRecord = { song, warnings, bytes: keep, name: file.name };
      if (!rangeFitsWindow(song)) {
        setStage({ kind: 'range-offer', pendingRecord });
      } else if (song.maxSimultaneity > MAX_SIMULTANEITY) {
        setStage({ kind: 'simultaneity-offer', pendingRecord });
      } else {
        await store(pendingRecord);
      }
    } catch (err) {
      setStage({
        kind: 'error',
        name: file.name,
        message:
          err instanceof SongFormatError ? err.message : 'Import failed — the file could not be processed',
      });
    }
  }, [store]);

  const acceptFold = async (p: PendingRecord) => {
    const target = findWindowBase(p.song.playableRange.min, p.song.playableRange.max) ?? DEFAULT_WINDOW_BASE;
    const { notes, folded } = foldToWindow(p.song.notes, target);
    let song = withDerived({ ...p.song, notes });
    // Folding can create collisions/density — re-validate everything.
    if (!rangeFitsWindow(song)) {
      // fold again against the recomputed best window (rare)
      const base2 = DEFAULT_WINDOW_BASE + song.baseWindowOffset;
      song = withDerived({ ...song, notes: foldToWindow(song.notes, base2).notes });
    }
    const next: PendingRecord = {
      ...p,
      song,
      warnings: [
        ...p.warnings,
        { kind: 'range-folded', message: `${folded} notes were moved by octaves to fit the playable window` },
      ],
    };
    if (song.maxSimultaneity > MAX_SIMULTANEITY) {
      setStage({ kind: 'simultaneity-offer', pendingRecord: next });
    } else {
      await store(next);
    }
  };

  const acceptAnyway = async (p: PendingRecord, kind: 'range' | 'simul') => {
    await store(p, [
      kind === 'range'
        ? { kind: 'range-folded', message: 'Imported with notes outside the playable window — octave-shift (Z/X) needed mid-piece' }
        : { kind: 'chords-thinned', message: `Contains chords of up to ${p.song.maxSimultaneity} notes — may exceed your keyboard's limits` },
    ]);
  };

  const thinChords = async (p: PendingRecord) => {
    // Keep the 4 highest-velocity (then outermost) notes per overlapping cluster.
    const sorted = [...p.song.notes].sort((a, b) => a.startTick - b.startTick);
    const kept: typeof sorted = [];
    for (const n of sorted) {
      const overlapping = kept.filter(
        (k) => k.startTick < n.startTick + n.durationTick && n.startTick < k.startTick + k.durationTick,
      );
      if (overlapping.length < MAX_SIMULTANEITY) {
        kept.push(n);
      } else {
        // replace the quietest inner overlapping note if this one is louder
        const weakest = overlapping.reduce((a, b) => (a.velocity <= b.velocity ? a : b));
        if (n.velocity > weakest.velocity) {
          kept.splice(kept.indexOf(weakest), 1);
          kept.push(n);
        }
      }
    }
    const dropped = p.song.notes.length - kept.length;
    const song = withDerived({ ...p.song, notes: kept });
    await store(
      { ...p, song },
      [{ kind: 'chords-thinned', message: `${dropped} notes thinned from dense chords (max 4 simultaneous)` }],
    );
  };

  return (
    <main className="page">
      <h1>Import sheet music</h1>
      <p>
        <Link to="/">← Library</Link>
      </p>
      {storageOk === false && (
        <p className="banner" role="alert">
          Storage is unavailable in this browser (private mode?). Importing is disabled — songs
          could not be saved.
        </p>
      )}

      {stage.kind === 'idle' && storageOk !== false && (
        <div
          className="drop-target"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          <p>Drop a file here, or</p>
          <button className="primary" onClick={() => fileRef.current?.click()}>
            Choose a file
          </button>
          <p className="hint">Accepted: .mid, .midi, .musicxml, .xml, .mxl</p>
          <p className="hint">
            MusicXML files with repeats/voltas/D.C./D.S. are rejected — expand repeats in your
            editor or export MIDI instead. Grace notes are dropped with a warning.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".mid,.midi,.musicxml,.xml,.mxl"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {stage.kind === 'parsing' && (
        <p aria-live="polite">
          <span className="spinner" /> Parsing {stage.name}…
        </p>
      )}

      {stage.kind === 'range-offer' && (
        <RangeDialog
          p={stage.pendingRecord}
          onFold={() => acceptFold(stage.pendingRecord)}
          onKeep={() => acceptAnyway(stage.pendingRecord, 'range')}
          onCancel={() => setStage({ kind: 'idle' })}
        />
      )}

      {stage.kind === 'simultaneity-offer' && (
        <section className="popover">
          <h2>Dense chords</h2>
          <p>
            This piece has up to {stage.pendingRecord.song.maxSimultaneity} simultaneous notes.
            Most computer keyboards can't register that many keys at once.
          </p>
          <div className="config-actions">
            <button onClick={() => setStage({ kind: 'idle' })}>Cancel</button>
            <button onClick={() => acceptAnyway(stage.pendingRecord, 'simul')}>Import anyway</button>
            <button className="primary" onClick={() => thinChords(stage.pendingRecord)}>
              Thin to 4 notes
            </button>
          </div>
        </section>
      )}

      {stage.kind === 'success' && (
        <section className="popover">
          <h2>Imported “{stage.record.song.title}”</h2>
          {stage.record.warnings.map((w, i) => (
            <p key={i} className="warn-inline">
              ⚠ {w.message}
            </p>
          ))}
          {exportNotice && (
            <p className="hint">
              Imported songs live in this browser's storage — clearing site data deletes them.{' '}
              <button
                className="link"
                onClick={async () => {
                  downloadBlob(await exportBackup(), 'piano-practice-backup.json');
                  setExportNotice(false);
                }}
              >
                Export a backup
              </button>{' '}
              <button className="link" onClick={() => setExportNotice(false)}>
                dismiss
              </button>
            </p>
          )}
          <div className="config-actions">
            <button onClick={() => setStage({ kind: 'idle' })}>Import another</button>
            <button className="primary" onClick={() => navigate(`/practice/${stage.record.id}`)}>
              Practice now
            </button>
          </div>
        </section>
      )}

      {stage.kind === 'duplicate' && (
        <p role="status">
          “{stage.name}” is already in your library.{' '}
          <button className="link" onClick={() => setStage({ kind: 'idle' })}>
            Import another
          </button>
        </p>
      )}

      {stage.kind === 'error' && (
        <section role="alert" className="popover error">
          <h2>Couldn't import {stage.name}</h2>
          <p>{stage.message}</p>
          <button className="primary" onClick={() => setStage({ kind: 'idle' })}>
            Try another file
          </button>
        </section>
      )}

      <section aria-label="Backup">
        <h2>Backup</h2>
        <p className="hint">Backups include the original files, so they survive a storage wipe.</p>
        <div className="config-actions">
          <button onClick={async () => downloadBlob(await exportBackup(), 'piano-practice-backup.json')}>
            Export backup
          </button>
          <button onClick={() => backupRef.current?.click()} disabled={storageOk === false}>
            Restore backup
          </button>
          <input
            ref={backupRef}
            type="file"
            accept=".json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                setRestore(await restoreBackup(await f.text()));
              } catch (err) {
                setStage({
                  kind: 'error',
                  name: f.name,
                  message: err instanceof SongFormatError ? err.message : 'Restore failed',
                });
              }
            }}
          />
        </div>
        {restore && (
          <p role="status">
            Restored {restore.restored} songs
            {restore.skippedDuplicates > 0 && `, skipped ${restore.skippedDuplicates} duplicates`}
            {restore.failed.length > 0 && `, ${restore.failed.length} failed`}
            {restore.failed.length > 0 && (
              <span className="hint"> ({restore.failed.map((f) => `${f.name}: ${f.reason}`).join('; ')})</span>
            )}
          </p>
        )}
      </section>
    </main>
  );
}

function RangeDialog({
  p,
  onFold,
  onKeep,
  onCancel,
}: {
  p: PendingRecord;
  onFold: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const { min, max } = p.song.playableRange;
  const windowBase = DEFAULT_WINDOW_BASE + p.song.baseWindowOffset;
  const lo = Math.min(min, windowBase);
  const hi = Math.max(max, windowBase + WINDOW_SPAN - 1);
  const pct = (m: number) => ((m - lo) / Math.max(1, hi - lo)) * 100;
  return (
    <section className="popover">
      <h2>Range exceeds the playable window</h2>
      <p>
        This piece spans {midiToName(min)}–{midiToName(max)} ({max - min + 1} semitones); the
        keyboard window covers {WINDOW_SPAN} at a time.
      </p>
      <div className="range-diagram" aria-hidden="true">
        <div className="range-bar song" style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }} />
        <div
          className="range-bar window"
          style={{ left: `${pct(windowBase)}%`, width: `${pct(windowBase + WINDOW_SPAN - 1) - pct(windowBase)}%` }}
        />
        <span className="range-label">song range vs playable window</span>
      </div>
      <div className="config-actions">
        <button onClick={onCancel}>Cancel</button>
        <button onClick={onKeep}>Keep as written</button>
        <button className="primary" onClick={onFold}>
          Fold octaves to fit
        </button>
      </div>
    </section>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
