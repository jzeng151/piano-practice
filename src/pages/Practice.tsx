import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { compileSong } from '../songs/compile';
import type { CompiledSong, PracticeSong } from '../songs/types';
import {
  PracticeController,
  getPiano,
  getPianoProgress,
  subscribePianoProgress,
  type PracticeConfig,
} from '../practice/controller';
import { checkSampleHealth, type SampleHealth } from '../audio/piano';
import type { GuideMode, HandFilter } from '../engine/clock';
import { midiToName, WINDOW_SPAN } from '../input/keyboard';
import { getBuiltinSong } from '../songs/library';
import { getSong, getPieceSettings, putPieceSettings, getAppSettings, putAppSettings } from '../storage/db';

type Phase = 'config' | 'running' | 'paused' | 'finished';

/** True while the AudioContext is actually producing sound. */
function useAudioRunning(): boolean {
  const piano = getPiano();
  return useSyncExternalStore(
    (cb) => piano.onStateChange(cb),
    () => piano.isRunning(),
  );
}

function AudioBlockedBanner() {
  const running = useAudioRunning();
  if (running) return null;
  return (
    <p className="banner audio-blocked" role="alert">
      🔇 The browser is blocking audio — press any key or click anywhere to enable sound.
    </p>
  );
}

export default function Practice() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const [song, setSong] = useState<PracticeSong | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!songId) return;
      const builtin = getBuiltinSong(songId);
      if (builtin) {
        if (!cancelled) setSong(builtin);
        return;
      }
      try {
        const stored = await getSong(songId);
        if (cancelled) return;
        if (stored) setSong(stored.song);
        else setLoadError('Song not found');
      } catch {
        if (!cancelled) setLoadError('Storage unavailable — this song cannot be loaded');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [songId]);

  if (loadError) {
    return (
      <main className="page">
        <p role="alert">{loadError}</p>
        <button onClick={() => navigate('/')}>Back to library</button>
      </main>
    );
  }
  if (!song) return <main className="page">Loading…</main>;

  let compiled: CompiledSong;
  try {
    compiled = compileSong(song);
  } catch {
    return (
      <main className="page">
        <p role="alert">This song could not be compiled.</p>
        <button onClick={() => navigate('/')}>Back to library</button>
      </main>
    );
  }
  return <PracticeSession key={song.id} compiled={compiled} />;
}

function PracticeSession({ compiled }: { compiled: CompiledSong }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('config');
  const [config, setConfig] = useState<PracticeConfig>({
    mode: 'wait',
    speed: 0.5,
    hands: 'both',
    countIn: true,
    pedalLatch: false,
  });
  const [firstRun, setFirstRun] = useState(false);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    (async () => {
      const [piece, app] = await Promise.all([
        getPieceSettings(compiled.song.id).catch(() => undefined),
        getAppSettings(),
      ]);
      setFirstRun(!app.seenMappingIntro);
      setConfig((c) => ({
        ...c,
        pedalLatch: app.pedalLatch,
        ...(piece ? { mode: piece.mode, speed: piece.speed, hands: piece.hands } : {}),
      }));
    })();
  }, [compiled.song.id]);

  const persistSettings = useCallback(
    (c: PracticeConfig) => {
      putPieceSettings({
        songId: compiled.song.id,
        mode: c.mode,
        speed: c.speed,
        hands: c.hands,
      }).catch(() => undefined);
    },
    [compiled.song.id],
  );

  const start = useCallback(
    async (c: PracticeConfig) => {
      setConfig(c);
      persistSettings(c);
      if (firstRun) {
        const app = await getAppSettings();
        putAppSettings({ ...app, seenMappingIntro: true }).catch(() => undefined);
        setFirstRun(false);
      }
      setRunKey((k) => k + 1);
      setPhase('running');
    },
    [firstRun, persistSettings],
  );

  return phase === 'config' ? (
    <ConfigPopover
      compiled={compiled}
      config={config}
      firstRun={firstRun}
      onStart={start}
      onBack={() => navigate('/')}
    />
  ) : (
    <RunningSession
      key={runKey}
      compiled={compiled}
      config={config}
      onExit={() => navigate('/')}
      onRestart={(c) => {
        setConfig(c);
        persistSettings(c);
        setRunKey((k) => k + 1);
      }}
    />
  );
}

function ConfigPopover({
  compiled,
  config,
  firstRun,
  onStart,
  onBack,
}: {
  compiled: CompiledSong;
  config: PracticeConfig;
  firstRun: boolean;
  onStart: (c: PracticeConfig) => void;
  onBack: () => void;
}) {
  const [local, setLocal] = useState(config);
  // render-time adjustment when async-loaded settings replace the config
  const [prevConfig, setPrevConfig] = useState(config);
  if (prevConfig !== config) {
    setPrevConfig(config);
    setLocal(config);
  }
  const progress = useSyncExternalStore(subscribePianoProgress, getPianoProgress);
  const [decoded, setDecoded] = useState(false);
  const [health, setHealth] = useState<SampleHealth | null>(null);
  const previewRef = useRef<PracticeController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkSampleHealth(getPiano().context)
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Live keys behind the popover: a preview controller in idle state —
  // audio is FSM-independent, so pressing keys sounds immediately.
  useEffect(() => {
    const piano = getPiano();
    piano.load().then(() => setDecoded(true));
    const ctrl = new PracticeController(compiled, local, piano);
    previewRef.current = ctrl;
    if (canvasRef.current) ctrl.attach(canvasRef.current);
    const onFirstGesture = () => piano.resume();
    window.addEventListener('keydown', onFirstGesture, { once: true });
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    return () => {
      window.removeEventListener('keydown', onFirstGesture);
      window.removeEventListener('pointerdown', onFirstGesture);
      ctrl.detach();
      previewRef.current = null;
    };
    // local changes don't need a rebuild for preview purposes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled]);

  const hasHands = compiled.song.notes.some((n) => n.hand !== 'unknown');
  const pct = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
  const latency = decoded ? getPiano().latencyInfo() : null;

  return (
    <main className="practice-layout">
      <canvas ref={canvasRef} className="lane-canvas" aria-hidden="true" />
      <div className="overlay">
        <section className="popover" aria-label="Practice setup">
          <h1>
            {compiled.song.title}
            <span className="composer"> — {compiled.song.composer || 'imported'}</span>
          </h1>
          {firstRun && <MappingDiagram />}
          <AudioBlockedBanner />
          {health && health.failed > 0 && (
            <p className="banner" role="alert">
              ⚠ {health.failed} of {health.tested} piano sound files failed to load in this
              browser ({health.firstError}). Keys will be partly or fully silent.
            </p>
          )}
          <p className="hint">
            The keyboard behind this dialog is live — try pressing some keys.
            {latency && (
              <>
                {' '}
                Audio output latency ≈{' '}
                {latency.outputLatency !== null
                  ? `${Math.round((latency.outputLatency + latency.baseLatency) * 1000)} ms`
                  : `${Math.round(latency.baseLatency * 1000)} ms (partial — this browser doesn't report output latency)`}
                .
              </>
            )}
          </p>
          <div className="config-row" role="group" aria-label="Guide mode">
            <span>Mode</span>
            <Choice
              value={local.mode}
              options={[
                ['wait', 'Wait for me'],
                ['scroll', 'Scroll + score'],
              ]}
              onChange={(mode) => setLocal({ ...local, mode: mode as GuideMode })}
            />
          </div>
          <div className="config-row" role="group" aria-label="Speed">
            <span>Speed</span>
            <Choice
              value={String(local.speed)}
              options={[
                ['0.5', '0.5×'],
                ['0.75', '0.75×'],
                ['1', '1×'],
              ]}
              onChange={(s) => setLocal({ ...local, speed: parseFloat(s) })}
            />
          </div>
          <div className="config-row" role="group" aria-label="Hands">
            <span>Hands</span>
            <Choice
              value={local.hands}
              options={[
                ['both', 'Both'],
                ['R', 'Right (auto-play left)'],
                ['L', 'Left (auto-play right)'],
              ]}
              disabled={!hasHands}
              onChange={(hands) => setLocal({ ...local, hands: hands as HandFilter })}
            />
            {!hasHands && <small>this song has no hand data</small>}
          </div>
          <div className="config-row">
            <label>
              <input
                type="checkbox"
                checked={local.countIn}
                onChange={(e) => setLocal({ ...local, countIn: e.target.checked })}
              />
              Count-in click (scroll mode)
            </label>
            <label>
              <input
                type="checkbox"
                checked={local.pedalLatch}
                onChange={(e) => setLocal({ ...local, pedalLatch: e.target.checked })}
              />
              Pedal latch (space toggles)
            </label>
          </div>
          <div className="config-actions">
            <button onClick={onBack}>Back</button>
            <button
              className="primary"
              disabled={!decoded}
              onClick={() => {
                previewRef.current?.detach();
                previewRef.current = null;
                onStart(local);
              }}
            >
              {decoded ? 'Start' : `Loading piano… ${pct}%`}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function MappingDiagram() {
  return (
    <div className="mapping-diagram">
      <pre aria-label="Keyboard mapping diagram">{`  w e   t y u   o p     ← black keys
 a s d f g h j k l ; '   ← white keys (a = C)
 [z] octave down  [x] octave up  [space] pedal`}</pre>
    </div>
  );
}

function Choice({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="choice">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={v === value ? 'selected' : ''}
          disabled={disabled}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RunningSession({
  compiled,
  config,
  onExit,
  onRestart,
}: {
  compiled: CompiledSong;
  config: PracticeConfig;
  onExit: () => void;
  onRestart: (c: PracticeConfig) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // One controller per mount — key={runKey} on this component guarantees a
  // fresh instance per run, so config/compiled changes always remount.
  const [controller] = useState(() => new PracticeController(compiled, config, getPiano()));
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [octaveBase, setOctaveBase] = useState(controller.songWindowBase);

  useEffect(() => {
    if (canvasRef.current) controller.attach(canvasRef.current);
    controller.start();
    const interval = setInterval(() => setOctaveBase(controller.input.getWindowBase()), 250);
    return () => {
      clearInterval(interval);
      controller.detach();
    };
  }, [controller]);

  // Page-level keys: Escape pauses; brackets set loop markers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = controller.getSnapshot();
      if (e.code === 'Escape') {
        if (s.state === 'playing' || s.state === 'waiting') controller.pause();
        e.preventDefault();
      } else if (e.code === 'BracketLeft' && (s.state === 'playing' || s.state === 'waiting')) {
        controller.setLoopMarker('A');
        e.preventDefault();
      } else if (e.code === 'BracketRight' && (s.state === 'playing' || s.state === 'waiting')) {
        controller.setLoopMarker('B');
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  const octaveShifted = octaveBase !== controller.songWindowBase;
  const progress = Math.min(1, Math.max(0, snap.songTime / snap.durationSec));

  return (
    <main className="practice-layout">
      <header className="status-strip">
        <span className="title">♪ {compiled.song.title}</span>
        <span className={octaveShifted ? 'octave warn' : 'octave'} aria-live="polite">
          {midiToName(octaveBase)}–{midiToName(octaveBase + WINDOW_SPAN - 1)}
          {octaveShifted &&
            ` — octave shifted, press ${octaveBase < controller.songWindowBase ? 'X' : 'Z'} to return`}
        </span>
        <span>
          {snap.mode === 'wait' ? 'Wait' : 'Scroll'} · {snap.speed}×
          {snap.hands !== 'both' && ` · ${snap.hands} hand`}
        </span>
        {snap.loopA !== null && <span className="loop-ind">loop {snap.loopB !== null ? 'A–B' : 'A–'}</span>}
        <progress value={progress} max={1} aria-label="Song progress" />
        <button
          onClick={() => {
            if (snap.state === 'playing' || snap.state === 'waiting') controller.pause();
          }}
        >
          Pause (Esc)
        </button>
      </header>
      <AudioBlockedBanner />
      <canvas ref={canvasRef} className="lane-canvas" />
      <div aria-live="polite" className="sr-only">
        {snap.state === 'waiting' && 'Waiting for the highlighted keys'}
        {snap.state === 'paused' && 'Paused'}
        {snap.state === 'finished' && 'Finished'}
      </div>
      {snap.state === 'paused' && (
        <PauseOverlay
          config={config}
          snap={{ loopA: snap.loopA, loopB: snap.loopB }}
          onResume={() => {
            (document.activeElement as HTMLElement | null)?.blur();
            controller.resume();
          }}
          onRestart={(c) => onRestart(c)}
          onClearLoop={() => controller.clearLoop()}
          onExit={onExit}
        />
      )}
      {snap.state === 'finished' && (
        <FinishedCard
          mode={snap.mode}
          counts={snap.counts}
          accuracy={snap.accuracy}
          wrongPresses={snap.wrongPresses}
          elapsedRealSec={snap.elapsedRealSec}
          onReplay={() => onRestart(config)}
          onSwitchMode={() =>
            onRestart({ ...config, mode: config.mode === 'wait' ? 'scroll' : 'wait' })
          }
          onExit={onExit}
        />
      )}
    </main>
  );
}

function PauseOverlay({
  config,
  snap,
  onResume,
  onRestart,
  onClearLoop,
  onExit,
}: {
  config: PracticeConfig;
  snap: { loopA: number | null; loopB: number | null };
  onResume: () => void;
  onRestart: (c: PracticeConfig) => void;
  onClearLoop: () => void;
  onExit: () => void;
}) {
  const [local, setLocal] = useState(config);
  const changed = local.mode !== config.mode || local.speed !== config.speed || local.hands !== config.hands;
  return (
    <div className="overlay">
      <section className="popover" aria-label="Paused">
        <h2>Paused</h2>
        <div className="config-row">
          <span>Mode</span>
          <Choice
            value={local.mode}
            options={[
              ['wait', 'Wait'],
              ['scroll', 'Scroll'],
            ]}
            onChange={(m) => setLocal({ ...local, mode: m as GuideMode })}
          />
        </div>
        <div className="config-row">
          <span>Speed</span>
          <Choice
            value={String(local.speed)}
            options={[
              ['0.5', '0.5×'],
              ['0.75', '0.75×'],
              ['1', '1×'],
            ]}
            onChange={(s) => setLocal({ ...local, speed: parseFloat(s) })}
          />
        </div>
        <p className="hint">Changing speed or mode restarts the piece. Loop markers: [ and ] while playing.</p>
        {(snap.loopA !== null || snap.loopB !== null) && (
          <button onClick={onClearLoop}>Clear A–B loop</button>
        )}
        <div className="config-actions">
          <button onClick={onExit}>Exit</button>
          <Link to="/keyboard-test">Keyboard test</Link>
          {changed ? (
            <button className="primary" onClick={() => onRestart(local)}>
              Restart with changes
            </button>
          ) : (
            <button className="primary" onClick={onResume}>
              Resume
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function FinishedCard({
  mode,
  counts,
  accuracy,
  wrongPresses,
  elapsedRealSec,
  onReplay,
  onSwitchMode,
  onExit,
}: {
  mode: GuideMode;
  counts: { hit: number; early: number; late: number; miss: number; wrong: number; total: number };
  accuracy: number;
  wrongPresses: number;
  elapsedRealSec: number;
  onReplay: () => void;
  onSwitchMode: () => void;
  onExit: () => void;
}) {
  const mins = Math.floor(elapsedRealSec / 60);
  const secs = Math.round(elapsedRealSec % 60);
  return (
    <div className="overlay">
      <section className="popover" aria-label="Finished">
        <h2>Finished!</h2>
        {mode === 'wait' ? (
          <p>
            Time: {mins}:{String(secs).padStart(2, '0')} · wrong presses: {wrongPresses}
          </p>
        ) : (
          <>
            <p className="big-accuracy">{Math.round(accuracy * 100)}%</p>
            <p>
              hit {counts.hit} · early {counts.early} · late {counts.late} · miss {counts.miss} ·
              wrong {counts.wrong}
            </p>
          </>
        )}
        <div className="config-actions">
          <button onClick={onExit}>Library</button>
          <button onClick={onSwitchMode}>{mode === 'wait' ? 'Try scroll mode' : 'Try wait mode'}</button>
          <button className="primary" onClick={onReplay}>
            Replay
          </button>
        </div>
      </section>
    </div>
  );
}
