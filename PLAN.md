<!-- /autoplan restore point: /home/steve/.gstack/projects/piano-practice/HEAD-autoplan-restore-20260610-145532.md -->
# Piano Practice — Implementation Plan

A web app for practicing piano pieces on a computer keyboard, with a Synthesia-style
guided note stream, a built-in classical library, and a MIDI/MusicXML importer.

## Premises (all user-confirmed 2026-06-10)

1. **Keyboard-native practice game.** Home-row keys don't share piano geometry; this
   trains key-sequence memory, timing, and guided-prompt reading — not transferable
   piano fingering technique and not staff-notation reading. We optimize for that.
2. **Simultaneity cap.** Cheap membrane keyboards ghost unpredictably on 3+ key
   combinations (the limit is per-combination, not a flat count). Built-in
   arrangements cap at ≤4 simultaneous notes; the app ships a keyboard rollover test;
   the importer flags or thins denser chords.
3. **Melody + simple accompaniment, not full two-hand classical.** Z/X octave
   shift is global, so the two hands cannot be octaves apart at the same instant. The
   playable window is ~18 semitones at any moment. Pieces are arranged to fit, or
   octave-folded on import. Continuous a→' mapping kept exactly as specified;
   split-register mode explicitly rejected at the premise gate (D2.1).
4. **Content sourcing.** Built-in pieces arranged in-house as MIDI from public-domain
   works (Mutopia/own arrangements) — solves licensing and playability at once.
   The HARDEST piece (widest natural span, e.g. Gymnopédie No. 1) is arranged FIRST,
   as a Milestone-1 spike with an ear test — if it sounds mangled inside the
   18-semitone window, re-pick narrower-span pieces before arranging the rest.
5. **Storage reality.** Songs live in IndexedDB; clearing browser data deletes them;
   JSON export/import is the backup path.
6. **Wrong keys still sound in wait mode** (D2.2). A wrong keypress plays its note
   (free-play feel) and is marked visually. The audio engine is fully decoupled from
   the playback state machine. Wait mode is a learning aid (no rhythm pressure);
   scroll mode is the rhythm test.

## Fixed requirements

- **Mapping:** home row `a s d f g h j k l ; '` = white keys C–F across ~1.5 octaves
  (a = C of the current window); top row `w e t y u o p` = the black keys between
  them (C# D# F# G# A# C# D#); `z`/`x` = octave shift down/up (global, clamped to
  MIDI 21–108); `space` = sustain pedal (held; latch toggle in settings); held keys =
  held notes with accurate release.
  - Key identification uses `KeyboardEvent.code` (physical position); US-physical
    layout assumed. `preventDefault` on all mapped keys inside the practice view.
  - Each song gets a compile-time **base window offset** so its range centers in the
    mapped window — built-ins need no mid-piece octave shift; Z/X remains for manual
    shifting and free play.
- **Goal 1:** Library page listing the built-in classical pieces → practice view with
  initial config popover (speed 0.5×/0.75×/1× AND guide mode) → guided falling-note
  stream rendered on canvas.
  - **Wait mode:** playback gates at each note group until the held-key set ⊇ the
    group's note set (plain superset — extra held notes, including wrong ones, never
    block; wrong notes are marked). Chord coalescing window 40 ms, tunable.
  - **Scroll mode:** clock advances at chosen speed regardless; per-note
    hit/early/late/miss scored against a ±150 ms window (tunable); accuracy summary
    at the end.
  - **No auto-playback of guide notes in v1** — only user keypresses sound.
  - **FSM:** `idle → playing ⇄ waiting → finished`, plus `paused` reachable from
    playing/waiting (Esc or pause button; resume/restart offered). Window
    blur/visibilitychange → release all held notes + auto-pause.
  - Every keypress sounds its piano note; audio fires in the keydown handler,
    decoupled from the visual clock.
- **Goal 2:** Importer accepting `.mid`/`.midi` and `.musicxml`/`.xml`/`.mxl`
  (`.mxl` is a ZIP container — unzipped with `fflate`), compiled into the internal
  song format, stored in IndexedDB, playable identically to built-ins.
  - Import-time validation: playable-range check (offer octave-fold), simultaneity
    check (warn + offer chord-thinning), tempo-map extraction, sustain (CC64).
  - MusicXML supported constructs: notes/chords, ties, multiple voices, per-staff
    hand assignment, tempo marks, tuplets (no special handling — `<duration>`
    divisions already encode performed timing). Grace notes are **dropped with a
    visible warning** (defined lossy behavior). Files containing
    repeats/voltas/D.C./D.S. are **rejected loudly** with "expand repeats in your
    editor or export MIDI instead" — never silently miscompiled.
- **Constraints:** fully client-side (no backend/accounts), static deployment on
  Vercel, desktop-first, TypeScript.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite + React 18 + TypeScript (strict) | Static-hostable, user's default stack |
| Engine | Vanilla TS modules (no React in hot loop) | rAF render loop + keypress handling must not touch React reconciliation |
| Note lane | Canvas 2D (COMMITTED at CEO review) | Headroom at high scroll speed, no per-note DOM; parallel DOM status text for a11y |
| Audio | `smplr` (SplendidGrandPiano) | Sampled piano, velocity layers, `AudioContext({latencyHint:'interactive'})`; sustain-deferral logic is ours (the one BUILD inside this BUY) |
| MIDI parse | `@tonejs/midi` | Notes in ticks+seconds, tempo map, CC64 |
| MusicXML parse | `@stringsync/musicxml` (fallback: `musicxml-interfaces`) — smoke-tested in Milestone 1 spike | Parse-only need; OSMD is a renderer and explicitly rejected |
| .mxl unzip | `fflate` | .mxl is a ZIP container |
| Storage | `idb` (IndexedDB) | Songs + settings |
| Routing | `react-router-dom` | `/` library, `/practice/:songId`, `/import`, `/keyboard-test` |
| Tests | Vitest | User default |
| Deploy | Vercel static | Resolved at CEO review (was "Vercel or Netlify") |

## Internal song format (single IR all sources compile into)

```ts
interface PracticeSong {
  id: string; title: string; composer: string;
  source: 'builtin' | 'midi' | 'musicxml';
  ppq: number;
  tempoMap: { tick: number; bpm: number }[];
  notes: { startTick: number; durationTick: number; midi: number;
           hand: 'L' | 'R' | 'unknown';   // MusicXML staff 1/2 = R/L; MIDI with
                                           // exactly two note tracks = lower-avg-
                                           // pitch is L; else unknown
           velocity: number }[];           // consumed by per-hand auto-playback
  pedalEvents: { tick: number; down: boolean }[];
  playableRange: { min: number; max: number };   // computed at compile time
  maxSimultaneity: number;                        // computed at compile time
  baseWindowOffset: number;                       // semitones; centers song in window
}

// Derived at compile time (tempo map applied once; playback speed scales the
// clock, never the data):
interface NoteGroup {
  startSec: number;                // onset at 1x speed
  notes: { midi: number; durationSec: number; hand: 'L'|'R'|'unknown' }[];
}
```

Both guide modes consume the same `NoteGroup[]` timeline. The only difference is
clock policy: scroll = monotonic advance + scorer; wait = advance, then gate.

## Module layout

```
src/
  engine/        clock.ts (FSM: idle→playing⇄waiting→finished + paused), gating, scorer
  input/         keyboard.ts (event.code mapping, octave shift, coalescing, blur release), types.ts (InputSource seam)
  audio/         piano.ts (smplr wrapper, sustain deferral)
  songs/         compile.ts (IR→NoteGroups, base window offset), midi.ts, musicxml.ts, builtins/ (.mid + manifest)
  render/        lane.ts (canvas falling notes), keys.ts (on-screen keyboard highlight)
  storage/       db.ts (idb), export.ts (JSON backup)
  pages/         Library.tsx, Practice.tsx, Import.tsx, KeyboardTest.tsx
```

`InputSource` interface from day one (`{note, velocity, on|off, timestamp}` events);
only `KeyboardInputSource` ships now — the seam is cheap at the start, expensive to
retrofit. No Web MIDI implementation in this scope.

## The 10 built-in pieces (arranged to fit: ≤4 simultaneous notes, one 18-semitone window)

1. Satie — Gymnopédie No. 1 ← ARRANGED FIRST (hardest span; Milestone-1 ear-test spike)
2. Bach — Minuet in G (Anh. 114)
3. Beethoven — Ode to Joy (theme)
4. Beethoven — Für Elise (A section)
5. Pachelbel — Canon in D (simplified)
6. Clementi — Sonatina Op. 36 No. 1, mvt 1 (simplified)
7. Bach — Prelude in C (WTC I, BWV 846)
8. Brahms — Lullaby
9. Tchaikovsky — Swan Lake theme (simplified)
10. Grieg — In the Hall of the Mountain King (simplified)

If the Gymnopédie spike fails the ear test, swap wide-span pieces for naturally
narrow ones before arranging the rest. Arrangements authored in MuseScore, exported
to MIDI, committed to `src/songs/builtins/`, validated at build time against the
simultaneity/range caps (CI fails on violation).

## Milestones (each loops against its verification)

1. **Scaffold + audio spike + content spike** → verify: Vite app runs; pressing `a`
   sounds C from smplr; keydown→buffer-scheduled < 10 ms and reported
   `outputLatency + baseLatency` displayed (total budget ≤ 30 ms on dev machine;
   if the OS floor is higher, record and accept — scoring uses keydown timestamps,
   so correctness is unaffected); held key sustains; release stops (with pedal:
   sustains). Gymnopédie No. 1 arranged and ear-tested. `@stringsync/musicxml`
   smoke-tested (parse a MuseScore export).
2. **Input layer** → verify: Vitest unit tests for mapping (every `event.code`→MIDI
   note, octave shift clamps at 21–108, coalescing window groups chords, pedal
   latch, blur releases all keys); manual rollover test page shows simultaneous-key
   count and ghosted combinations.
3. **Song IR + compilers** → verify: golden-file tests — known .mid, .musicxml, and
   .mxl fixtures compile to expected `PracticeSong` + `NoteGroup[]` JSON (notes,
   tempo map incl. mid-piece tempo change, CC64, range/simultaneity/baseWindowOffset);
   one fixture per construct class: repeat-containing file rejected with the
   documented message, grace-note file compiles with grace notes dropped + warning
   recorded, triplet file compiles with correct timing.
4. **Engine + canvas lane** → verify: scroll mode plays a fixture at 0.5/0.75/1×
   with correct note-fall alignment (unit-test clock math incl. tempo changes); wait
   mode gates on note groups and resumes on correct chord (unit-test FSM transitions
   incl. paused and blur paths); A-B loop repeats the marked window in both modes
   (unit-test wrap-around + marker clearing); per-hand filter auto-plays the muted
   hand and gates/scores only the played hand; count-in click precedes scroll
   playback at the correct tempo.
5. **Practice view UI** → verify: config popover selects speed+mode before start;
   on-screen key highlights track guide + presses; wrong notes marked; pause/resume/
   restart work; scroll-mode accuracy summary renders.
6. **Library + 10 pieces** → verify: build-time validation passes for all 10;
   each loads and plays in both modes.
7. **Importer + storage** → verify: round-trip test — import .mid → IndexedDB →
   reload → plays; .mxl unzips and compiles; oversized range triggers octave-fold
   offer; oversized chords trigger thin/flag flow; repeats-rejection message shown;
   JSON export/import restores songs.
8. **Deploy** → verify: production build on Vercel; full flow works on the deployed
   URL.

## UI specification (added at design review; all four pages)

**Visual direction:** dark tool UI (falling-note lane over a dark field; reduces
canvas contrast work), one accent color reserved for guide notes/highlights, real
typeface (not system-ui), list-not-grid layouts, no hero section, no marketing
framing. Utility copy only. Minimum viewport 1024 px wide — narrower shows a
"window too narrow for practice" notice, no responsive reflow (desktop-first is
honest scope, not an afterthought).

**Practice view (the product):**
```
┌──────────────────────────────────────────────────────────┐
│ status strip: ♪ title · octave window "C3–F4" · pedal ●   │
│               mode/speed · pause btn · progress ▭▭▭       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   falling-note lane (canvas, dominant region)            │
│   · columns = the 18 semitone positions of the current   │
│     window ONLY (not 88 keys)                            │
│   · notes fall vertically; each note labeled with its    │
│     computer-key letter (g, u, ;…)                       │
│   · L/R hand color-coded when hand data exists           │
│   · fixed 4-second look-ahead in SONG time (0.5× shows   │
│     the same notes moving slower)                        │
│   · 2-second empty-lane lead-in before the first note    │
│     (scroll mode; v1 — fairness, not a feature)          │
├────────────── hit line ──────────────────────────────────┤
│ on-screen keyboard: piano-shaped keys labeled with the   │
│ computer-key letters; guide highlight = accent color;    │
│ pressed = lit; wrong press = red flash on the key plus a │
│ transient mark in its lane column, ~300 ms decay         │
└──────────────────────────────────────────────────────────┘
```
- **Wait-mode gating visual:** lane halts with the target group at the hit line;
  target notes pulse ("your turn"); each note in a chord lights as its key is held;
  lane resumes immediately on superset satisfaction (no ease-in — rhythm pressure
  is explicitly not wait mode's job).
- **Scroll-mode judgment:** per-note color change at the hit line
  (hit/early/late/miss), no text spam; full counts in the end summary.
- **Octave-shift safety:** status strip shows the current window; if it deviates
  from the song's `baseWindowOffset` during guided play, it becomes a warning
  ("octave shifted — press X to return") — prevents the accidental-Z soft-lock
  where wait mode appears frozen.
- **Input capture:** mapped keys play notes only while the practice view is focused
  and the FSM is playing/waiting; Esc pauses and releases capture; paused UI is
  Tab-navigable. Pause overlay: Resume / Restart / speed + mode controls labeled
  inline "changing speed or mode restarts the piece" / link to keyboard test.
- **Finished states:** wait mode → card with time taken + wrong-press count +
  Replay / Try scroll mode / Library. Scroll mode → hit/early/late/miss counts +
  percentage + Replay / Change speed / Library.
- **A-B loop (promoted at final gate):** set/clear loop markers from the pause
  overlay or via bracket keys `[` `]`; markers drawn on the lane; engine repeats
  the marked clock window until cleared; works in both modes.
- **Per-hand practice (promoted at final gate):** L / R / both filter in the
  config popover; the filtered-out hand is auto-played by the engine at its source
  velocity (this is the `velocity` field's consumer); disabled with a tooltip for
  songs whose notes are all `hand:'unknown'`.
- **Audible count-in (promoted at final gate):** scroll mode plays a 1-bar
  metronome click (tempo from the song's first tempo-map entry) over the 2-second
  visual lead-in; wait mode stays click-free.
- **Config popover (pre-start):** lane + on-screen keyboard render live BEHIND the
  popover and keys sound when pressed (audio is FSM-independent). Defaults: wait
  mode, 0.5×; last-used settings persisted per piece. First run additionally shows
  the mapping diagram (home row = white keys, top row = black keys, Z/X, space) and
  "try pressing some keys". Start button disabled until samples are decoded, with
  progress shown.

**Library:** two sections — Built-in / Your imports. Dense list (not card grid):
title, composer, ~duration, difficulty dots (1–3, derived from compile-time
`maxSimultaneity` + note density), per-piece Start. Built-ins sorted easiest-first
with a "Start here" marker on the easiest (the manifest's arrange-first-hardest
order is a build concern, never the display order). Loading = skeleton list (IDB
read is async — no flash-of-empty); imported song failing schema validation on
read renders as a broken-card row with a "remove" action (never silently omitted).
Empty imports section = "no imported songs yet → Import" card. Footer link to the
keyboard test.

**Importer:** drag-drop target + file button, accepted formats listed. Parsing
state with spinner (mxl unzip + parse can take visible time). Success screen:
primary "Practice now", secondary "Import another"; grace-note/thinning warnings
shown inline on the success screen (never a blocking modal); the export-backup
prompt is a dismissible inline notice, not a modal. Fold/thin dialogs show a
before/after range diagram (song range vs the 18-semitone window) + affected-note
counts ("12 notes moved up one octave"). The original file bytes are stored in
IndexedDB alongside the compiled song, so transformations are re-doable and
nothing is destroyed.

**Keyboard test:** a guided flow, not a readout — (a) instructions, (b) prompted
3–4-key chords drawn from actual built-in arrangements (ghosting is inferred from
missing keydowns), (c) verdict: "your keyboard handled all tested chords" or
"these combinations ghost — consider the pedal latch setting" with a link to it.
Entry points: library footer + practice pause overlay.

**Accessibility (honest v1 scope):** aria-live announces state transitions
(paused, finished, waiting-on-group) and the end summary — NOT every falling note.
The canvas lane itself is not non-visually accessible in v1; stated, not implied.
Focus order and visible focus indicators on all non-canvas UI; contrast ≥ 4.5:1 on
text; no color-only error cues (wrong-press flash pairs with the key outline).

**Interaction state table:**

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Library | skeleton list | "no imports yet" card | broken-row + remove | list | — |
| Practice start | popover w/ sample progress, Start disabled | — | sample-load error + reload | lane live | — |
| Practice play | — | — | octave-shift warning state | finished card | wait-gate pulse |
| Importer | parse spinner | drag-drop idle | per-error remediation (registry) | "Practice now" screen | grace/thin warnings inline |
| Keyboard test | — | instructions | — | verdict pass | verdict w/ ghosting list |
| JSON restore | progress | — | "not a valid backup" | songs restored toast | — |

## NOT in scope

- Web MIDI hardware input (InputSource seam exists; implementation deferred — TODOS)
- Mobile/touch support (desktop-first; keyboard is the product)
- Accounts, sync, server storage
- PDF/image sheet-music OCR (OMR)
- Sheet-music notation rendering (no OSMD/VexFlow)
- Split-register / per-hand octave mapping (rejected at premise gate D2.1)
- Per-piece progress tracking, latency calibration screen, measure-level error
  analytics (deferred — TODOS.md)
- Numeric grading beyond scroll-mode hit/miss accuracy; leaderboards
- Velocity-sensitive input (computer keyboards have none; fixed velocity)
- MusicXML repeat/volta/D.C./D.S. handling (rejected loudly at import with a
  documented message; MIDI export is the supported path). Grace notes dropped with
  a warning; tuplets fully supported via duration divisions.

## Failure modes & mitigations

| Risk | Mitigation |
|---|---|
| Keyboard ghosting breaks chords | ≤4-note cap, rollover test page, pedal latch option |
| Browser intercepts `'` / `;` (Firefox quick-find) | `preventDefault` on mapped keys in practice view; document Firefox caveat; rollover test surfaces it |
| Window blur loses keyup → stuck notes / broken gate | blur/visibilitychange handler releases all notes + auto-pauses |
| Pieces exceed playable window | Compile-time range check + per-song base window offset; arrangements pre-fitted; importer offers octave-fold |
| Arrangements sound mangled in 18-semitone window | Hardest piece arranged first (Milestone 1 ear test); swap repertoire if it fails |
| MusicXML repeats silently miscompile | Explicit construct allowlist; loud rejection with remediation message |
| Tempo drift on tempo-change pieces | Tempo map (not flat BPM) in IR; clock unit tests cover tempo changes |
| Audio latency on first note | Pre-load + decode samples at config popover; resume AudioContext on first gesture |
| IndexedDB wipe loses imports | JSON export/import; prompt to export after each import |
| Sample CDN outage / slow first load | Piano samples self-hosted in `public/samples/` (no third-party runtime dependency) |
| Zip bomb via .mxl | fflate decompression capped at 20 MB; reject with error message |
| Malicious/corrupt JSON backup import | Schema-validate before writing to IndexedDB; reject with error message |

## CEO Review additions (auto-decided 2026-06-10, audit trail below)

- **Self-hosted samples:** smplr's piano samples are vendored into `public/samples/`
  at build time; no runtime third-party CDN dependency.
- **Pause menu:** speed and guide mode are changeable from the pause overlay;
  applying a change restarts the piece (explicit over clever).
- **Error boundary:** a React ErrorBoundary wraps the app with a friendly recovery
  screen; engine teardown releases audio + listeners on unmount/navigation.
- **IndexedDB versioning:** `idb` openDB with version 1 + upgrade hook from day one.
- **Empty states:** library shows a "no imported songs yet → /import" card; importer
  shows per-error remediation text (see registry).

## Architecture (system diagram)

```
                    ┌────────────────────────────────────────────┐
                    │                 React shell                 │
                    │  Library.tsx  Import.tsx  KeyboardTest.tsx  │
                    │            Practice.tsx (mount ref)         │
                    └───────┬─────────────────────┬───────────────┘
                            │ mounts/unmounts     │ file picker
                            ▼                     ▼
   keydown/keyup   ┌─────────────────┐   ┌─────────────────────┐
  ───────────────▶ │  input/keyboard │   │  songs/midi|musicxml │
  (event.code)     │  map·shift·     │   │  parse → PracticeSong│
                   │  coalesce·blur  │   │  validate → fold/thin│
                   └───┬─────────┬───┘   └──────────┬──────────┘
                       │         │                  │
              InputSource     immediate          compile.ts
                events        keydown─▶audio        │
                       │         │                  ▼
                       ▼         ▼          ┌──────────────┐
                ┌──────────────────┐        │ NoteGroup[]  │
                │  engine/clock    │◀───────│  timeline    │
                │  FSM·gate·scorer │        └──────────────┘
                └───┬──────────┬───┘                │
                    │ rAF      │ note on/off        ▼
                    ▼          ▼             ┌──────────────┐
            ┌────────────┐ ┌────────────┐    │ storage/db   │
            │ render/lane│ │ audio/piano│    │ idb v1 + JSON│
            │ canvas 2D  │ │ smplr+pedal│    │ export/import│
            └────────────┘ └────────────┘    └──────────────┘
```

Coupling notes: engine knows the timeline and InputSource interface only; render
reads engine state read-only per frame; audio is invoked from BOTH the keydown
handler (user notes, latency-critical) and never from the FSM (premise 6).
Single point of failure: none external after sample self-hosting.
Rollback: static deploy → redeploy previous build; no migrations.

## Error & Rescue Registry

| Codepath | What can go wrong | Rescued? | Rescue action | User sees |
|---|---|---|---|---|
| midi.ts parse | Corrupt/truncated .mid | Y | catch parse error | "This MIDI file couldn't be read" + filename |
| midi.ts parse | Zero notes after parse | Y | explicit check | "File contains no playable notes" |
| musicxml.ts parse | Malformed XML | Y | catch parse error | "Not a valid MusicXML file" |
| musicxml.ts parse | Repeats/voltas/D.C./D.S. | Y | construct check, reject | "Expand repeats in your editor or export MIDI instead" |
| musicxml.ts parse | Grace notes present | Y | drop + warn | "Grace notes were omitted (N dropped)" |
| .mxl unzip | Corrupt zip / >20 MB decompressed | Y | fflate error / size cap | "Archive is corrupt or too large" |
| compile.ts | Range exceeds window after offset | Y | offer octave-fold | Fold dialog with preview |
| compile.ts | >4-note simultaneity | Y | offer thin / import anyway flagged | Thin dialog |
| storage/db | IndexedDB unavailable (private mode) | Y | detect on open | Banner: "Storage unavailable — imports won't persist" |
| storage/db | QuotaExceededError | Y | catch on write | "Storage full — export and remove songs" |
| export.ts import | Invalid/foreign JSON schema | Y | schema validation | "Not a valid backup file" |
| audio/piano | Sample fetch/decode failure | Y | retry once, then error state | "Couldn't load piano sounds — reload" |
| audio/piano | AudioContext blocked pre-gesture | Y | resume on first gesture (standard) | Nothing (transparent) |
| engine | Song with 0 NoteGroups reaches practice | Y | guard at load | Redirect to library + toast |

No unrescued GAPs remain; every row has a named user-visible outcome (zero silent
failures).

## Failure Modes Registry

| Codepath | Failure mode | Rescued? | Test? | User sees | Logged |
|---|---|---|---|---|---|
| Importer | corrupt file | Y | M3 golden | error message | console |
| Importer | construct rejection | Y | M3 fixture | remediation message | console |
| Input | ghosted chord | partial (hardware) | M2 manual page | rollover test explains | n/a |
| Input | blur mid-hold | Y | M2 unit | auto-pause | n/a |
| Engine | tempo-change drift | Y | M4 unit | correct alignment | n/a |
| Audio | sample load fail | Y | M1 manual | error + reload prompt | console |
| Storage | quota/private mode | Y | M7 unit | banner | console |

No row is simultaneously unrescued, untested, and silent → no CRITICAL GAPs.

## What already exists (greenfield: library leverage)

smplr (sound), @tonejs/midi (MIDI), @stringsync/musicxml (MusicXML), fflate (.mxl),
idb (storage), react-router-dom (routing). Custom builds limited to: key mapping,
clock/FSM/gate/scorer, canvas lane, importer validation — the app-specific core.

## Dream state delta

This plan ships the complete v1 (both guide modes, importer, library, rollover
test). Remaining distance to the 12-month ideal is exactly the TODOS.md list:
A-B loop, per-hand practice, progress, calibration, Web MIDI, measure analytics.

## Engineering spec (added at eng review — both voices; spec-level defects fixed before code)

**Transport (the canonical clock).** One transport owns song time: it accumulates
`performance.now()` deltas only while the FSM is `playing`, scaled by the speed
multiplier; it freezes in `waiting`/`paused` (no wall-clock subtraction, no
per-frame increments — immune to rAF throttling and long gates). All input
timestamps are normalized to song time through it. Audio fires immediately on
keydown; `AudioContext.currentTime` is never used for scoring. Both modes get the
2-second empty-lane lead-in.

**Wait-mode gate (v2 — fixes the repeated-note auto-pass).** A group is satisfied
when every pitch in it has a **fresh keydown since the group armed** and that
strike is still sounding (held, or sustained by the pedal). Merely holding a key
from the previous group never satisfies the next group (Für Elise's E–D#–E now
requires three strikes). The pedal union is what makes the rolled-chord-with-pedal
workaround for ghosting hardware actually work. `event.repeat` is ignored
everywhere; an authoritative pressed-physical-key set is maintained.

**Octave-shift correctness.** `code → soundedMidi` is recorded at keydown; keyup
releases the recorded pitch (shifting mid-hold can't strand voices or corrupt the
held set).

**Coalescing moves to compile time.** The 40 ms window is the NoteGroup onset
epsilon in `compile.ts` (humanized chord onsets in recorded MIDI group correctly).
The input layer does NO event batching; gate evaluation is immediate per event.

**Scorer contract.** ±150 ms window in REAL time (models motor accuracy; does not
scale with playback speed). Greedy nearest-unconsumed matching: one press consumes
at most one note of that pitch, one note consumed by at most one press; fresh
presses only. Repeated-pitch-within-window fixture required.

**Compile normalization.** Sweep-line simultaneity (a note ending at tick t does
not overlap one starting at t); unisons deduped within a group; overlapping
same-pitch notes truncated at the next onset; minimum duration clamp. Tick→sec
contract: default 120 BPM when no tempo at tick 0; last-wins for same-tick tempo
events; invalid BPM and SMPTE-division files rejected loudly; `durationSec`
integrates the tempo map across the note's full span (not onset-tempo
multiplication). Fold/thin are compile passes whose output re-enters ALL
validators (a fold creating a unison collision is caught, not shipped).

**Import pipeline.** Compilation (parse + unzip + validate) runs in a Web Worker
with progress + cancellation — the spinner is real, audio never stutters. `.mxl`
uses fflate's streaming Unzip: compressed-size, decompressed-size (20 MB),
per-entry, and entry-count caps enforced during streaming; rootfile discovered via
`META-INF/container.xml` (only the rootfile is extracted; missing rootfile =
rejection). MusicXML construct contract: `<backup>`/`<forward>` (voices),
mid-part `<divisions>` changes, and rests are SUPPORTED; multi-part files take the
densest part with a warning; transposing-instrument parts rejected; repeat
detection gets adversarial fixtures (namespaces, segno/coda, direction words).
Hand assignment is deterministic: MusicXML staff 1/2 = R/L; MIDI with exactly two
note tracks = lower-average-pitch track is L; anything else = `unknown`.

**Audio voice model.** One voice per keydown instance; re-striking a sounding
pitch stops the prior voice first; pedal-up flushes ALL deferred releases;
polyphony cap 32 with oldest-voice stealing; panic (pedal flush FIRST, then key
releases) on blur/teardown/restart. The deferral logic is pure bookkeeping over an
injected player interface — unit-tested in Vitest with a fake player; only the
sound itself stays manual. Imported `pedalEvents` are source-fidelity data with no
v1 runtime consumer (documented, not dead code smuggling).

**Finish semantics.** Scroll: finished when the last note's scoring window closes;
all voices force-released. Wait: final group satisfied → finished card immediately,
audio rings out naturally.

**InputSource seam (v2).** Event union gains `{type:'pedal', down, timestamp}` —
a future WebMidiInputSource delivers CC64 through the seam instead of forcing a
retrofit. Octave shift stays keyboard-internal (MIDI devices send absolute
pitches).

**React boundary.** Engine exposes `subscribe/getSnapshot`; React consumes via
`useSyncExternalStore`. Engine setup is idempotent and teardown total (rAF,
listeners, audio) — StrictMode double-mount safe; dev mount/unmount/mount smoke
test. Audio-enabled states: popover-preview, playing, waiting (not paused/finished
/other pages); the focused control is blurred when capture resumes so `space`
can't trigger a button.

**Storage schema.** Records carry `schemaVersion` + `compilerVersion` (a compiler
fix can trigger recompilation from stored original bytes). `songId` =
content-hash of the original file bytes — stable across export/restore, dedupes
re-imports, keeps per-piece settings attached. JSON export includes original
bytes (base64) per song with a size warning; restore is staged and atomic;
duplicate IDs skipped with notice; quota surfaced via `navigator.storage.estimate()`
with selective delete. IndexedDB unavailable (private mode) → import is DISABLED
with an explicit notice — never fake-success into a memory hole.

**Rendering/platform.** Canvas sized via ResizeObserver with `devicePixelRatio`
scaling, re-checked on resize/zoom/monitor change. `outputLatency` read "where
available" (Safari lacks it; fall back to `baseLatency` + "(partial)" tag).
Vercel config gets the SPA catch-all rewrite to `index.html` (deep links to
`/practice/:songId` must not 404). CI = typecheck (strict), eslint, vitest,
production build, builtin-fixture validation, sample-asset existence, lockfile
enforced.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| M1 scaffold/audio/content spike | repo root, audio/, public/samples | — |
| M2 input layer | input/ | M1 |
| M3 IR + compilers (worker) | songs/ | M1 |
| M4 engine + lane | engine/, render/ | M2, M3 |
| M5 practice UI | pages/Practice | M4 |
| M6 library + pieces | pages/Library, songs/builtins | M3 |
| M7 importer + storage | pages/Import, storage/ | M3 |
| M8 deploy | vercel config | all |

Lanes after M1: **A:** M2→M4→M5 (input→engine→practice UI) · **B:** M3→M6
(compilers→library) · **C:** M3→M7 (compilers→importer; B and C both depend on M3
but touch disjoint modules afterward). Launch A and B in parallel after M1; C
after M3 lands. Conflict flag: M6 and M7 both touch `storage/db.ts` reads —
sequence C after B's library work or coordinate on the db module.

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Canvas 2D lane (Approach B) committed | Mechanical→closed taste | P5,P3 | Milestones assume canvas; headroom for modest extra code | DOM/SVG, PixiJS |
| 2 | CEO | InputSource seam ships, keyboard impl only | Mechanical | P5 | Cheap at start, expensive retrofit; lifts future ceiling | building Web MIDI now |
| 3 | CEO | Zero expansions auto-added (user CLAUDE.md overrides gstack auto-approve) | Mechanical | user rules | "No features beyond what was asked" supersedes boil-the-ocean | auto-adding 8 candidates |
| 4 | CEO | Hardest piece (Gymnopédie) arranged first as M1 ear-test spike | Mechanical | P6 | Content feasibility is the top risk; fail it early | arrange in M6 as planned |
| 5 | CEO | No pitch-split hand inference in v1 | Mechanical | P5 | Only consumer (per-hand) is pending; fields kept, logic deferred | middle-C split now |
| 6 | CEO | MusicXML: tuplets native, grace notes dropped+warned, repeats rejected loudly | Mechanical | P1,P5 | Duration divisions already encode tuplet timing; never silently miscompile | rejecting tuplets (too harsh), silent linearization |
| 7 | CEO | Scroll mode: no auto-playback of guide notes in v1 | Mechanical | P5 | Practice tool — user makes the sound; velocity field dormant | play-along audio |
| 8 | CEO | Self-host piano samples in public/ | Mechanical | P1 | Removes third-party runtime SPOF | CDN at runtime |
| 9 | CEO | .mxl decompression capped 20 MB; JSON backup schema-validated | Mechanical | P1 | Untrusted-input hardening, both one-liners | trusting input |
| 10 | CEO | Pause overlay allows speed/mode change with restart | Mechanical | P5 | Explicit restart beats mid-flight remap | live remapping |
| 11 | CEO | ErrorBoundary + engine teardown on unmount | Mechanical | P1 | Zero silent failures; audio must stop on navigation | none |
| 12 | CEO | idb version 1 + upgrade hook from day one | Mechanical | P1 | Future schema changes need a path | versionless |
| 13 | CEO | Latency criterion = schedule <10 ms + reported outputLatency budget | Mechanical | P5 | Original "<30 ms measured" not honestly measurable in-browser | unmeasurable gate |
| 14 | CEO | Count-in → final gate (taste); A-B loop + per-hand → final gate (User Challenge) | Taste/Challenge | — | Both models recommend loop+per-hand; user said minimal | silent inclusion |
| 15 | CEO | Library stays at 10 pieces pending gate (models recommend 3) | User Challenge | — | User explicitly specified 10; models must make the case | silent cut |
| 16 | CEO | MusicXML stays in scope with construct allowlist (models leaned MIDI-only) | User Challenge | — | User explicitly chose MIDI+MusicXML | silent descope |
| 17 | Design | Practice-view geometry committed: 18-semitone lane (not 88 keys), letter-labeled falling notes, letter-labeled piano-shaped keys, hand color-coding | Mechanical | P5 | Both voices: a literal Synthesia clone would build the wrong product for a key-sequence trainer | unlabeled 88-key clone |
| 18 | Design | 2-second empty-lane lead-in ships in v1 scroll mode (revises #14's count-in deferral; audible click remains a gate option) | Mechanical (cross-model) | P1 | Both voices: first-note-is-an-unfair-miss is a correctness defect in the scored mode, not a feature | cold start |
| 19 | Design | Config popover: defaults wait/0.5×, last-used persisted per piece, live keys behind popover, first-run mapping diagram, Start gated on sample decode | Mechanical | P1 | First-time user cannot choose modes they've never seen; mapping must be taught before the first falling note | cold settings quiz |
| 20 | Design | Library = dense list, easiest-first, difficulty dots from compile-time metrics; manifest order ≠ display order | Mechanical | P5 | Arrange-first-hardest is a build concern; showing Gymnopédie first to a beginner is a trap | card grid in manifest order |
| 21 | Design | Importer success screen ("Practice now" primary); original file bytes stored alongside compiled song (transformations re-doable) | Mechanical | P1 | Fastest path to value is import→play; destructive-only transforms forced re-import | modal nag + lossy transforms |
| 22 | Design | Keyboard test = guided chord-prompt flow with verdict + remediation links | Mechanical | P1 | Ghosting is the absence of events; a passive readout cannot detect it | passive counter page |
| 23 | Design | A11y honest scope (aria-live on transitions/summary only; canvas not non-visually accessible in v1); min viewport 1024 px notice | Mechanical | P5 | Honest stated limits beat aspirational checkbox phrases | "parallel DOM status text" hand-wave |
| 24 | Design | Visual mockup board generation skipped | Mechanical | — | Interactive feedback-loop flow incompatible with autoplan autonomous mode; /design-shotgun available later | generating unreviewed mockups |
| 25 | Eng | Wait-gate v2: fresh-keydown-since-arm ∪ pedal-sustained strikes | Mechanical (cross-model CRITICAL) | P1 | Held-key superset silently auto-passed repeated notes on ≥2 built-ins; pedal union makes the ghosting workaround real | held-set ⊇ |
| 26 | Eng | Transport = delta-accumulating clock frozen in waiting/paused; real-time scorer window; greedy nearest-unconsumed matching | Mechanical (cross-model) | P5 | Wall-clock subtraction breaks gating; window models motor accuracy | per-frame increments, song-time window |
| 27 | Eng | Coalescing = compile-time NoteGroup epsilon; input layer never batches | Mechanical (cross-model) | P5 | Humanized imports otherwise gate note-by-note through chords; input batching would delay audio | input-side 40ms batching |
| 28 | Eng | code→soundedMidi recorded at keydown; release by record | Mechanical (cross-model) | P1 | Octave shift mid-hold otherwise strands voices | naive remap on keyup |
| 29 | Eng | Import compilation in Web Worker; .mxl streaming caps + container.xml rootfile discovery | Mechanical (cross-model) | P1 | Sync parse blocks the promised spinner; sync unzip can't enforce the 20MB cap | main-thread unzipSync |
| 30 | Eng | MusicXML contract: backup/forward + divisions + rests supported; densest part w/ warning; SMPTE + transposing parts rejected; tick→sec contract w/ tempo-span integration | Mechanical | P1 | backup/forward IS how voices are encoded — rejecting them would gut the format support the user asked for | naive single-voice parse |
| 31 | Eng | Voice model: per-keydown voices, re-strike stops prior, pedal-first panic, polyphony cap 32, deferral unit-tested via fake player | Mechanical (cross-model) | P1 | Stuck/ringing audio is the most user-visible failure class | untestable manual-only audio |
| 32 | Eng | songId = content hash; schemaVersion+compilerVersion on records; export embeds original bytes; staged atomic restore; IDB-unavailable disables import explicitly | Mechanical (cross-model) | P1 | Stable IDs fix settings orphaning + dedupe; fake-success into memory was a silent-failure path | uuid ids, lossy export |
| 33 | Eng | useSyncExternalStore boundary; idempotent engine setup (StrictMode-safe) | Mechanical (cross-model) | P5 | Double-mounted rAF loops + duplicate listeners are guaranteed in dev otherwise | polling/lifted state |
| 34 | Eng | Vercel SPA rewrite; CI = typecheck/eslint/vitest/build/fixture+sample checks | Mechanical | P1 | Deep links 404 without it; build-time validation was promised but unwired | implicit CI |
| 35 | Eng | Playwright E2E deferred to TODOS (single-voice rec); /qa + /verify cover interactive flows for v1 | Taste (logged) | P3,user rules | Codex recommended browser-level tests; user minimalism + existing QA tooling argue for deferral | Playwright in v1 |
| 36 | Gate | Library stays at 10 pieces | User decision | — | User kept original direction against both models' cut-to-3 recommendation | 3 or 5 pieces |
| 37 | Gate | A-B loop + per-hand practice PROMOTED to v1 | User decision (accepting challenge) | — | User accepted both models' recommendation; auto-playback path activates, velocity gains consumer | keep deferred |
| 38 | Gate | MusicXML kept with construct contract | User decision | — | User kept original direction against models' MIDI-only lean | descope |
| 39 | Gate | Audible 1-bar count-in in scroll mode | User decision (taste) | — | Nearly free once auto-playback path exists; audible pulse sets tempo | visual-only lead-in |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (via /autoplan) | 8 proposals, 3 accepted at gate, 4 deferred; spec loop 9/10 PASS |
| Codex Review | `/codex review` | Independent 2nd opinion | 3 voices | CLEAR (via /autoplan) | CEO 12 / Design 18 / Eng 30 findings, all folded or gated |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (via /autoplan) | 51 issues across voices, 0 critical gaps remaining |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (via /autoplan) | score 3/10 → 8/10, 8 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | SKIPPED | no developer-facing scope |

- **CROSS-MODEL:** 10 cross-model confirmations in the eng phase (incl. 1 critical wait-gate spec defect caught pre-code); design phase 6/7 passes confirmed by both voices; CEO phase split 3 confirmed / 2 disagreements, resolved at the user gate.
- **VERDICT:** CEO + DESIGN + ENG CLEARED — APPROVED, ready to implement.

NO UNRESOLVED DECISIONS
