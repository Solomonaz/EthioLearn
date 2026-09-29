# Abugida — Elementary Games Roadmap

> Working reference for the **grades 1–6 games** build.
> Scoped to the elementary side on 2026-08-13. The secondary "smart writing" system
> (tickets, handwriting→math, 3D geometry) is **deferred** — see the bottom section.
> Corrected against the actual codebase: Supabase is gone, real-time already exists.

---

## Scope

**Build the elementary (grades 1–6) side: teacher-hosted card games + tug-of-war, on a
single classroom screen.** Three phases, in order:

```
Phase 0  Content foundation ..... the shared schema + generator; build first
Phase 1  Free teacher hooks ..... onboarding + the content generator that feeds games
Phase 2  Games (elementary) ..... memory, find-the-pair, grouping, tug-of-war
```

One line: **content engine → teacher onboarding → elementary games.**

The secondary platform (grades 7–12: quiz, tutor, battle, billing) already exists and is
untouched by this work. The advanced "smart writing" features are a separate system, out
of scope for now (listed at the end so they aren't forgotten).

---

## The classroom constraint (drives everything)

**Students are not allowed phones in class. A classroom has one shared screen (a projector
or the teacher's device) and zero student devices.**

Consequences:

- **Every classroom feature is single-screen, teacher-driven** — teacher hosts, teams/kids
  answer aloud or take turns at the board, teacher taps. All elementary games are built
  this way.
- **No multi-device classroom play.** Kahoot-style live quiz (PIN/QR join on student
  phones) was considered and **removed** — there's no join path when students have no
  devices.
- **No student logins for elementary.** Kids never authenticate; the teacher is the only
  account in the room.

---

## Audience & integration model

The elementary games are for a **different kind of user** than the existing 7–12 student —
not a younger version of the same one. Integrate through the **teacher**, not a student
account.

**Decision: one app, one backend, one content engine — two front-of-house surfaces,
branched by grade band.**

| | Secondary (7–12) — exists today | Elementary (1–6) — this build |
|---|---|---|
| **Actor** | Student, self-directed | **Teacher**, classroom-hosted |
| **Login** | Student phone+OTP | Teacher account; **kids need no login** |
| **Surface** | `/student/*` dashboard | Teacher-hosted "kids mode" screen |
| **Device** | Personal phone (at home) | **Single shared screen; no student devices** |
| **UI** | Text-rich dashboard | Icon-driven, minimal text, Amharic-friendly |
| **Materials** | Uploaded textbooks → RAG | **No uploads — none required** |
| **Access** | Full feature set | **Card games + tug-of-war only** |

Why this works:

- **`grade` is already `Int?` on `User`** ([`schema.prisma:132`](../prisma/schema.prisma))
  and `Int` on content. Extending the domain to 1–6 is **pure data**, no migration.
- **Do not fork the app or build a second product.** Same repo, same DB, same engine;
  branch only the presentation via a `gradeBand`.
- **The teacher is who we onboard in Phase 1 anyway.** One teacher account can own a
  grade-4 class and a grade-10 class.

**Access control:** a `gradeBand` derived from `grade` (`1–6` vs `7–12`) selects the
surface and gates features. The elementary surface exposes **only** the games.

---

## Phase 0 — Shared content foundation (build first)

The single most leverage-heavy step: generate content once, skin it many ways. A memory
game, find-the-pair, grouping, and tug-of-war should all pull from the **same content
rows**, just rendered differently. Nothing downstream starts until this is stable.

- **A small type-discriminated content model.** Elementary games need a few content shapes,
  so give content a `type` + flexible `jsonb` payload from the start (cheap, and lets us
  add game modes later without a migration):
  - `type`: `PAIR | CATEGORY | MCQ`
    - `PAIR` → memory game, find-the-pair, tug-of-war prompts
    - `CATEGORY` → grouping
    - `MCQ` → tug-of-war question rounds (optional)
  - **shared columns:** subject, grade, **`gradeBand`**, curriculum tag, media refs,
    tier/entitlement
  - **per-type `payload jsonb`:** pair-associations, category labels, distractors
- **`gradeBand` is first-class.** Derived from `grade` (`1–6` / `7–12`); drives surface
  selection and access gating. Cheap now, annoying to retrofit.
- **Content is generated, not uploaded.** Elementary content comes from a **topic prompt**
  (e.g. "8 animal-name pairs for grade 2" — no source document) or is **teacher-authored**.
  The RAG / textbook pipeline is **not** needed here.
- **Bilingual media fields:** Amharic + English text, image URL, audio URL. Amharic-first
  matters for young learners.
- **Entitlements live here, not "added later."** Add a `tier` / entitlement concept + one
  gate helper now. Freemium checks touch every game.

**Reuses:** Amharic OCR (for any image content), Prisma/Postgres + pgvector, the existing
AI generation stack.

**Deliverable:** a `Content` Prisma model (with the `type` enum, `gradeBand`, `jsonb`
payload, entitlement fields) plus a generator endpoint that fills it from a topic prompt.

---

## Phase 1 — Free teacher hooks (fastest to ship)

Lowest effort, no real-time, gets teachers into the product.

- **Google + email one-click onboarding** (NextAuth is already wired) — teacher signup.
- **Teacher-facing AI generator UX** — topic/subject/grade → instant game content. This is
  the Phase 0 generator with a simple UI. **This is what produces the pair/category content
  the games consume** — no uploads.
- **Random picker** (student / question / team) — a free-tier hook, trivial build, useful
  in any classroom.

**Outcome:** a teacher signs up and generates grade-appropriate game content in minutes.

---

## Phase 2 — Games (elementary): card games + tug-of-war

All target grades 1–6, all teacher-hosted on a single shared screen. Build as one set —
they share the Phase 0 content.

Card games (consume `PAIR` / `CATEGORY` content — **pure frontend state, no server
round-trips**):

- **Memory game** — flip-to-match; single-player or turn-taking; per-grade leaderboard via
  **Prisma/Postgres**.
- **Find the pair** — two-column matching; same `PAIR` content, different layout.
- **Grouping** — drag-and-drop into categories; uses `CATEGORY` content.

Tug-of-war:

- **Single-screen classroom only.** Two teams compete on the shared screen; teacher
  adjudicates and taps answers. **No multi-device mode** — students have no phones in class.
  This is local screen state, not networked play.

Shared context for the phase:

- **Teacher-hosted, single shared screen, no student logins, no uploads.** Content is
  generated or teacher-authored via Phase 1.
- **Elementary "kids mode" surface** (`/play` or `/classroom`): icon-driven, low-text,
  large touch targets, Amharic-friendly. Selected by `gradeBand`.
- Because everything is single-screen, these games are **largely local-state** and do not
  need the Socket.io engine — a simpler build than networked multiplayer.

**Outcome:** four teacher-run game modes from one content generator, on a single classroom
screen — matching how Ethiopian classrooms actually work.

---

## Cross-cutting (layer in as games ship)

- **Freemium entitlements** — schema-level from Phase 0. Free = Random picker + capped
  generations; PRO = find-the-pair, grouping, richer game modes.
- **Gamification shell** — points, per-grade leaderboards; attach as each game ships.
  Leaderboards on Prisma/Postgres.
- **Localized pricing in ETB.**

---

## Context: the existing real-time engine & Battle Mode

[`server.ts`](../server.ts) runs a working Socket.io engine (rooms, live leaderboards,
spectate, disconnect handling) powering a shipping **Battle Mode** — student-vs-student
quiz on `/student/battle`, PRO-gated. That's an **at-home, personal-device** feature for
secondary students; the no-phones classroom rule does not touch it. The elementary games
in this plan are single-screen and **do not depend on that engine** — noted here only so
it isn't assumed to be part of the elementary build.

Also corrected from earlier drafts: **Supabase was dropped** (it survives only in
`.env.example` / `next.config.ts`); persistence and any real-time are **Prisma/Postgres +
the existing Socket.io**, never Supabase.

---

## Deferred — out of scope for now (secondary "smart writing" system)

These are a separate, more sophisticated system for the 7–12 side. **Not part of this
build**; recorded so they aren't lost:

- **Tickets & exam formatting** — test tickets, worksheet generation + online fill-in.
- **Smart writing: math layer** — handwriting → math recognition (Gemini/MyScript),
  instant graph plotting (LaTeX → function-plot / JSXGraph).
- **Smart writing: 3D layer** — sketch → constrained 3D primitives, Three.js manipulation
  (vertex/plane selection, cross-sections, orbit controls).

When these come back into scope, the Phase 0 `type` enum extends to cover them
(`INK_MATH | PLOT | GEOMETRY_3D`) — which is exactly why the content model is
type-discriminated now.
