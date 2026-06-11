# TODOS

Deferred items from the 2026-06-10 /autoplan review. Each entry has enough context
to pick up cold.

## PROMOTED to v1 at the 2026-06-10 final gate
- A-B section loop, per-hand practice, and audible scroll-mode count-in were
  promoted into PLAN.md v1 scope (User Challenges accepted). See PLAN.md UI
  specification and audit trail rows 37/39.

## P3 — Per-piece progress (best accuracy per piece/speed on library card)
- **Effort:** human ~4h / CC ~20min. Needs schema: `{songId, speed, mode, bestAccuracy, lastPlayed}`.

## P3 — Latency calibration screen
- **What:** Measure and store a per-machine audio+visual offset applied to
  scroll-mode scoring windows.
- **Effort:** human ~1d / CC ~30min.

## P3 — Web MIDI input
- **What:** `WebMidiInputSource` implementing the existing InputSource seam;
  auto-detect, offer when present. Lifts rollover/velocity/range ceilings entirely.
- **Effort:** human ~1d / CC ~1h. Both review models noted this is the highest-upside
  deferred item.

## P3 — Measure-level error analytics
- **What:** Scroll-mode summary grouped by measure; "practice this section" links
  (pairs with A-B loop).
- **Effort:** human ~1d / CC ~30min. **Depends on:** A-B loop (now in v1).

## P3 — Competitive survey (30 min, manual)
- **What:** Spend 30 minutes with virtualpiano.net and midiano.com before/during
  Milestone 1; confirm no free tool already combines wait-mode gating +
  typing-keyboard input + local MIDI import.

## P3 — Design system consultation
- **What:** Run /design-consultation to produce a DESIGN.md (typography, color
  tokens, spacing) — the plan ships a minimal "dark tool UI" direction without a
  formal system.
- **Why:** Pass 5 of the design review flagged the missing DESIGN.md; fine for v1,
  worth formalizing before any visual expansion.

## P3 — Playwright E2E smoke suite
- **What:** Browser-level tests for focus/blur/held-key/pause-resume/import-reload
  flows that Vitest+jsdom can't exercise.
- **Why:** Codex eng review recommended; deferred per minimalism — /qa and /verify
  cover interactive verification for v1. Revisit if regressions appear in flows
  unit tests can't reach.
