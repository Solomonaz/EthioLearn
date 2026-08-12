# EthioLearn — Feature Roadmap (corrected plan)

> Working reference for the games + smart-writing expansion.
> Corrected against the actual codebase on 2026-08-12. Two things changed vs. the
> original draft: **real-time infrastructure already exists**, and **Supabase is gone**.

---

## What changed from the original draft, and why

Two findings in the codebase reshuffle the plan — both in our favor:

1. **Real-time is already built.** [`server.ts`](../server.ts) runs a complete Socket.io
   engine: rooms, `create_room` / `join_room`, `start_game`, `submit_answer`, live
   leaderboards, rematch, **spectate mode**, and disconnect handling — plus a working
   `battle/[roomCode]` feature. It even has an `isLeaderPenalty` scoring modifier (the
   current leader earns less), which is already a tug-of-war–style balancing dynamic.
   → The original "Phase 5 is the first feature needing WebSocket infrastructure" is no
   longer true. That infrastructure is running today.

2. **Supabase was dropped.** It survives only in `.env.example` and `next.config.ts`;
   the app runs on Docker Postgres + pgvector with our own Socket.io layer. Every
   "Supabase" / "Supabase Realtime" in the original plan now reads
   **Prisma/Postgres + existing Socket.io**. This is a *subtraction* of work, not an
   addition — do not reintroduce a dependency we deliberately removed.

**Net effect:** live multiplayer is mostly cash-in-hand and gets pulled forward; the only
genuinely hard/uncertain work stays last (3D, and the Amharic edge of handwriting→math).

---

## Sequencing (corrected)

```
Phase 0  Content foundation ......... build first, everything depends on it
Phase 1  Free utility hooks ......... teacher signups
Phase 1.5 Live quiz rooms (PULLED FORWARD) ... engine already exists; biggest hook
Phase 2  Card-based games ........... memory / find-the-pair / grouping
Phase 3  Tickets & exam formatting .. presentation layer on core engine
Phase 4  Smart writing: math layer .. handwriting→math, instant plotting
Phase 5  Live multiplayer (remainder) ... tug-of-war modes, multi-device polish
Phase 6  Smart writing: 3D layer .... hardest, deliberately last

Cross-cutting from day one: freemium entitlements, gamification shell, ETB pricing
```

One line: **content engine → free hooks → live quiz → card games → tickets → math writing → tug-of-war → 3D**, with monetization and gamification layered across all of it.

---

## Phase 0 — Shared content foundation (build first)

The single most leverage-heavy step: generate content once, skin it many ways. Nothing
downstream starts until this is stable.

- **Type-discriminated schema, not a quiz-only schema.** The original draft modeled only
  question/pair/category content. But Phase 4/6 produce fundamentally different content —
  ink strokes, LaTeX, geometry parameters — that will not fit a question/pair shape.
  Design a `type` discriminant + flexible `jsonb` payload now, or we migrate at Phase 4.
  - `type`: `MCQ | PAIR | CATEGORY | INK_MATH | PLOT | GEOMETRY_3D | …`
  - shared columns: subject, grade, curriculum tag, media refs, tier/entitlement
  - per-type `payload jsonb`: distractors, pair-associations, category labels, LaTeX,
    stroke data, 3D primitive params
- **Curriculum tagging:** grade + subject + Ethiopian curriculum alignment.
- **Bilingual media fields:** Amharic + English text, image URL, audio URL. Reuses the
  RAG pipeline and Amharic OCR.
- **Entitlements live here, not in "cross-cutting later."** Add a `tier` / entitlement
  concept and one gate helper now. Every downstream feature checks limits; retrofitting
  quota checks across six phases is miserable.

**Reuses:** RAG pipeline, Amharic OCR, Prisma/Postgres + pgvector.

---

## Phase 1 — Free utility hooks (fastest to ship)

Lowest effort, no real-time, gets teachers into the product.

- **Random picker** (student / question / team) — free-tier hook, trivial build.
- **Teacher-facing AI generator UX** on top of the existing exam engine
  (topic/subject/grade → instant worksheet/quiz). Highest-value adaptation and mostly UX,
  since the engine already exists (see `/api/quizzes/generate-ai`).
- **Google + email one-click onboarding** (NextAuth is already wired).

**Outcome:** a teacher signs up and generates curriculum content in minutes.

---

## Phase 1.5 — Live quiz rooms (PULLED FORWARD)

Was Phase 5. Moved up because the engine already exists and this is the single biggest
engagement lever — Kahoot-style live competition is the core pitch to teachers.

- **PIN/QR join → live room**, reusing Phase 0–1 content. Mostly content-wiring + UX on
  top of the existing Socket.io rooms in `server.ts`, **not** an infra build.
- Backing store: **Prisma/Postgres** (not Supabase Realtime). Room state is already
  in-memory in `server.ts`; persist results via Prisma.
- **Single-device classroom mode first** (teacher hosts on a projector, no per-student
  login) — matches Ethiopian one-screen classrooms. This is a spectate subscription to a
  host room, which the engine already supports.

**Outcome:** live competition feeding off content we already generate — shipped early,
not sat on until the end.

---

## Phase 2 — Card-based games (build as a set)

All three consume the "pair/set" content from Phase 0 — build together.

- **Memory game** — single-player, pure frontend state; per-grade leaderboard via
  **Prisma/Postgres**.
- **Find the pair** — two-column matching, same pair content, different layout.
- **Grouping** — drag-and-drop into categories; one step up, same pipeline.

**Outcome:** three game modes from one content generator, no new infra, ideal for
elementary.

---

## Phase 3 — Tickets & exam formatting (presentation layer)

- **Test tickets** (numbered question sets) — formatted exam output, our strongest
  existing capability.
- **Worksheet generation + online fill-in + results view.**

**Outcome:** teacher-credible exam tools with almost no new engine work; natural PRO-tier
features.

---

## Phase 4 — Smart interactive writing: math layer (the real differentiator)

The two writing features with the most educational value that reuse existing infra.

- **Handwriting → math recognition.** Prototype with the existing Gemini pipeline
  (`@google/generative-ai`); upgrade to MyScript iink only if accuracy demands it.
  - **Validate the Amharic edge early.** Amharic is our moat and our risk. Test
    handwriting→math against *Amharic-language problem statements* before committing to
    any MyScript upgrade — mixed Amharic/math ink is where Gemini may wobble.
  - Render results with **KaTeX** or **MathLive**.
- **Instant graph plotting.** LaTeX → parse (`mathjs`) → render with **function-plot** or
  **JSXGraph** on a Cartesian grid. Fully client-side.

**Outcome:** handwriting-to-math and auto-plotting — features no competitor on our list
has.

---

## Phase 5 — Live multiplayer (remainder)

Most of this moved to Phase 1.5. What's left is the tug-of-war family and multi-device
polish — an evolution of the existing engine, not a new build.

- **Tug of war** — single-device classroom mode first (spectate a host room), then
  multi-device. The `isLeaderPenalty` modifier already in `server.ts` is the seed of this
  mechanic; **extract it as a generic "scoring modifier" primitive** so tug-of-war, live
  quiz, and future modes share it.
- **Multi-device room polish** — reconnection, richer host controls.

**Outcome:** classroom-scale competition built on infrastructure we already run.

---

## Phase 6 — Smart writing: 3D layer (hardest, do last)

Deliberately last so nothing else waits on it.

- **Shape recognition → constrained 3D primitives** (cube / sphere / cylinder via
  **Three.js** — a fixed primitive library, *not* freeform mesh generation). Classify the
  sketch into a known primitive, then instantiate a clean parametric mesh.
- **3D manipulation tools** — Three.js raycasting for vertex/plane selection, clipping
  planes for cross-sections, 2D face projection, orbit controls. Runs fully client-side.

Suggested stack: `three` + `@react-three/fiber` + `@react-three/drei`.

**Outcome:** interactive 3D geometry — the most technically ambitious feature, last on
purpose.

---

## Cross-cutting (layer in continuously)

- **Freemium entitlements** — schema-level from Phase 0 (see above), not bolted on late.
  Free = utilities (Random) + capped generations; PRO = find-the-pair, grouping, tickets,
  richer game modes.
- **Gamification shell** — points, levels, per-grade leaderboards; attach as each game
  ships. Leaderboards on Prisma/Postgres.
- **Localized pricing in ETB.**
- **Single-screen / offline-friendly as a standing constraint.** The best product call in
  the original draft. Extend it beyond tug-of-war: Three.js and function-plot run fully
  client-side, so design Phase 4/6 for "one projector, no per-student login" too.

---

## Standing corrections (apply everywhere)

| Original assumption | Corrected reality |
|---|---|
| Supabase for leaderboards / persistence | **Prisma/Postgres** (Supabase was dropped) |
| Supabase Realtime for live features | **Existing Socket.io in `server.ts`** |
| Phase 5 = first real-time build | Real-time already exists; **live quiz pulled to Phase 1.5** |
| Phase 0 = quiz/pair/category schema | **Type-discriminated schema** (covers ink/LaTeX/3D) |
| Freemium = cross-cutting, added later | **Entitlements in the Phase 0 schema** |
