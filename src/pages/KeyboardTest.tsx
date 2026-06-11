import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { KEY_OFFSETS, letterForOffset } from '../input/keyboard';

// Guided rollover test: ghosting is the ABSENCE of events, so we prompt real
// chords from the built-in arrangements and infer dropped keys from what
// never arrives while the others are held.
interface Prompt {
  label: string;
  codes: string[];
}

const PROMPTS: Prompt[] = [
  { label: 'Two-note chord (C+E)', codes: ['KeyA', 'KeyD'] },
  { label: 'Three-note chord (C+E+G)', codes: ['KeyA', 'KeyD', 'KeyG'] },
  { label: 'Three notes + pedal', codes: ['KeyA', 'KeyD', 'KeyG', 'Space'] },
  { label: 'Four-note chord (C+E+G+C)', codes: ['KeyA', 'KeyD', 'KeyG', 'KeyK'] },
  { label: 'Four notes with a black key (C+D#+G+C)', codes: ['KeyA', 'KeyE', 'KeyG', 'KeyK'] },
  { label: 'Four notes + pedal', codes: ['KeyA', 'KeyD', 'KeyG', 'KeyK', 'Space'] },
];

type Phase = 'intro' | 'testing' | 'verdict';

export default function KeyboardTest() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [promptIndex, setPromptIndex] = useState(0);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<boolean[]>([]);

  const prompt = PROMPTS[promptIndex];

  const advance = () => {
    if (promptIndex + 1 >= PROMPTS.length) setPhase('verdict');
    else setPromptIndex((i) => i + 1);
  };

  useEffect(() => {
    if (phase !== 'testing') return;
    const target = PROMPTS[promptIndex];
    const down = (e: KeyboardEvent) => {
      if (e.code in KEY_OFFSETS || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      setHeld((h) => {
        const next = new Set(h).add(e.code);
        if (target.codes.every((c) => next.has(c))) {
          // chord complete — record and advance from the event handler
          setResults((r) => [...r, true]);
          if (promptIndex + 1 >= PROMPTS.length) setPhase('verdict');
          else setPromptIndex(promptIndex + 1);
          return new Set<string>();
        }
        return next;
      });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code in KEY_OFFSETS || e.code === 'Space') e.preventDefault();
      setHeld((h) => {
        const next = new Set(h);
        next.delete(e.code);
        return next;
      });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [phase, promptIndex]);

  const skip = () => {
    setResults((r) => [...r, false]);
    setHeld(new Set());
    advance();
  };

  const failed = useMemo(
    () => PROMPTS.filter((_, i) => results[i] === false),
    [results],
  );

  const keyLabel = (code: string) =>
    code === 'Space' ? 'space' : letterForOffset(KEY_OFFSETS[code] ?? -1) || code;

  return (
    <main className="page">
      <h1>Keyboard chord test</h1>
      <p>
        <Link to="/">← Library</Link>
      </p>

      {phase === 'intro' && (
        <section>
          <p>
            Many keyboards can't register some combinations of 3+ keys pressed together ("ghosting").
            This test walks you through the chord shapes the built-in pieces actually use, so you
            know in advance whether your hardware can play them.
          </p>
          <p className="hint">
            Hold all the keys of each prompted chord at the same time. If a chord won't register no
            matter what, press "I can't — skip".
          </p>
          <button className="primary" onClick={() => setPhase('testing')}>
            Start test
          </button>
        </section>
      )}

      {phase === 'testing' && prompt && (
        <section aria-live="polite">
          <h2>
            {promptIndex + 1} / {PROMPTS.length}: {prompt.label}
          </h2>
          <p className="chord-prompt">
            Hold together:{' '}
            {prompt.codes.map((c) => (
              <kbd key={c} className={held.has(c) ? 'held' : ''}>
                {keyLabel(c)}
              </kbd>
            ))}
          </p>
          <p className="hint">
            {prompt.codes.filter((c) => held.has(c)).length} of {prompt.codes.length} registered
          </p>
          <button onClick={skip}>I can't — skip</button>
        </section>
      )}

      {phase === 'verdict' && (
        <section role="status">
          {failed.length === 0 ? (
            <>
              <h2>✅ Your keyboard handled all tested chords</h2>
              <p>Every chord shape in the built-in arrangements registered cleanly.</p>
            </>
          ) : (
            <>
              <h2>⚠ Some combinations ghost on this keyboard</h2>
              <ul>
                {failed.map((p) => (
                  <li key={p.label}>{p.label}</li>
                ))}
              </ul>
              <p>
                Workaround: enable the <strong>pedal latch</strong> setting in the practice setup,
                hold the pedal, and roll the chord one note at a time — sustained notes count
                toward chords in wait mode.
              </p>
            </>
          )}
          <div className="config-actions">
            <button
              onClick={() => {
                setPhase('intro');
                setPromptIndex(0);
                setResults([]);
              }}
            >
              Run again
            </button>
            <Link className="button primary" to="/">
              Back to library
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
