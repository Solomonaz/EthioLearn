/**
 * Animated scene format — the contract behind real animated tutorials.
 *
 * The old "video tutorial" was a slide deck: the model picked one of seven
 * fixed layouts and filled it with text, so nothing on screen could ever be an
 * OBJECT that moves. A scene instead declares a cast of actors and a series of
 * keyframes that place them, which is what lets a lesson show sulfur dioxide
 * meeting water, a force acting on a block, or a cell dividing — the same
 * engine for every subject.
 *
 * Two deliberate choices make this something a language model can emit
 * reliably, and a renderer can trust:
 *
 *   1. COORDINATES ARE 0–100 on both axes, not pixels. A model reasons about
 *      "x: 25, y: 50" far more consistently than about a viewBox, and the
 *      renderer stays resolution-independent.
 *   2. COLOURS ARE NAMES from a fixed list, not hex. The model cannot invent an
 *      unreadable colour, and the renderer maps each name to a gradient tuned
 *      for the player's dark stage.
 *
 * `validateScene` repairs rather than rejects wherever it safely can — the same
 * stance as question validation: a scene with one bad actor should lose that
 * actor, not the whole lesson.
 */

// ─── Vocabulary ──────────────────────────────────────────

export const SCENE_COLORS = [
  "red", "orange", "yellow", "green", "cyan", "blue", "purple", "white", "grey",
] as const;
export type SceneColor = (typeof SCENE_COLORS)[number];

/**
 * Deliberately small. Three primitives compose into most of a curriculum: a
 * disc is an atom, a cell, a planet or a mass; a box is a block, a container or
 * a term; a label is a name, a formula or an annotation. Richer primitives
 * (plotted curves, particle fields, sprites) are additive later — every one of
 * them costs prompt reliability, so they earn their place one at a time.
 */
export const ACTOR_KINDS = ["circle", "box", "label"] as const;
export type SceneActorKind = (typeof ACTOR_KINDS)[number];

export const LINK_STYLES = ["line", "arrow"] as const;
export type SceneLinkStyle = (typeof LINK_STYLES)[number];

// ─── Authored shape (what a model emits) ─────────────────

export interface SceneActor {
  id: string;
  kind: SceneActorKind;
  /** Glyph or text shown: "S", "O", "Nucleus", "F = ma". */
  text: string;
  color?: SceneColor;
  /** Size multiplier, 0.5–2.5. Defaults to 1. */
  size?: number;
}

export interface SceneLink {
  id: string;
  /** Actor ids. */
  from: string;
  to: string;
  style?: SceneLinkStyle;
  color?: SceneColor;
}

export interface ScenePlacement {
  x: number;
  y: number;
  opacity: number;
}

export interface SceneStep {
  caption: string;
  /** Spoken line. Falls back to the caption. */
  narration?: string;
  durationMs?: number;
  /** actorId → where it should be at the END of this step. Partial: anything
   *  omitted holds its previous position. */
  place?: Record<string, Partial<ScenePlacement>>;
  /** linkId → bond strength. 0 absent, 1 single, 2 double. Partial. */
  links?: Record<string, number>;
}

export interface Scene {
  title: string;
  actors: SceneActor[];
  links: SceneLink[];
  steps: SceneStep[];
}

// ─── Resolved shape (what the player consumes) ───────────

export interface ResolvedFrame {
  caption: string;
  narration: string;
  durationMs: number;
  /** Every actor, absolute. */
  place: Record<string, ScenePlacement>;
  /** Every link, absolute. */
  links: Record<string, number>;
}

export interface ResolvedScene {
  title: string;
  actors: SceneActor[];
  links: SceneLink[];
  frames: ResolvedFrame[];
}

// ─── Limits ──────────────────────────────────────────────
// Caps exist so one runaway generation cannot produce a scene that is
// unreadable on a classroom projector or hostile to render.
const MAX_ACTORS = 24;
const MAX_LINKS = 24;
const MAX_STEPS = 12;
const MIN_STEP_MS = 900;
const MAX_STEP_MS = 9000;
const DEFAULT_STEP_MS = 2800;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function asFiniteNumber(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Accept a bare scene or the `{ "scene": {...} }` wrapper JSON mode tends to add. */
function unwrapScene(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const inner = (raw as Record<string, unknown>).scene;
    if (inner && typeof inner === "object") return inner;
  }
  return raw;
}

// ─── Validation ──────────────────────────────────────────

/**
 * Normalise an untrusted scene. Returns null only when nothing usable is left
 * — no actors, or no steps — so the caller can fall back rather than render an
 * empty stage.
 */
export function validateScene(raw: unknown): Scene | null {
  const src = unwrapScene(raw);
  if (!src || typeof src !== "object" || Array.isArray(src)) return null;
  const obj = src as Record<string, unknown>;

  // ── Actors ──
  const actors: SceneActor[] = [];
  const seenActorIds = new Set<string>();
  if (Array.isArray(obj.actors)) {
    for (const rawActor of obj.actors) {
      if (actors.length >= MAX_ACTORS) break;
      if (!rawActor || typeof rawActor !== "object") continue;
      const a = rawActor as Record<string, unknown>;

      const id = asText(a.id);
      if (!id || seenActorIds.has(id)) continue;

      const kind = ACTOR_KINDS.includes(a.kind as SceneActorKind)
        ? (a.kind as SceneActorKind)
        : "circle";

      // A label with no text is invisible; a circle without one is still a
      // legitimate object (an unlabelled particle), so only labels are dropped.
      const text = asText(a.text);
      if (kind === "label" && !text) continue;

      const color = SCENE_COLORS.includes(a.color as SceneColor)
        ? (a.color as SceneColor)
        : "cyan";

      seenActorIds.add(id);
      actors.push({
        id,
        kind,
        text,
        color,
        size: clamp(asFiniteNumber(a.size, 1), 0.5, 2.5),
      });
    }
  }
  if (actors.length === 0) return null;

  // ── Links ── (dropped when either endpoint does not exist)
  const links: SceneLink[] = [];
  const seenLinkIds = new Set<string>();
  if (Array.isArray(obj.links)) {
    for (const rawLink of obj.links) {
      if (links.length >= MAX_LINKS) break;
      if (!rawLink || typeof rawLink !== "object") continue;
      const l = rawLink as Record<string, unknown>;

      const id = asText(l.id);
      const from = asText(l.from);
      const to = asText(l.to);
      if (!id || seenLinkIds.has(id)) continue;
      if (!seenActorIds.has(from) || !seenActorIds.has(to) || from === to) continue;

      seenLinkIds.add(id);
      links.push({
        id,
        from,
        to,
        style: LINK_STYLES.includes(l.style as SceneLinkStyle) ? (l.style as SceneLinkStyle) : "line",
        color: SCENE_COLORS.includes(l.color as SceneColor) ? (l.color as SceneColor) : "grey",
      });
    }
  }

  // ── Steps ──
  const steps: SceneStep[] = [];
  if (Array.isArray(obj.steps)) {
    for (const rawStep of obj.steps) {
      if (steps.length >= MAX_STEPS) break;
      if (!rawStep || typeof rawStep !== "object") continue;
      const s = rawStep as Record<string, unknown>;

      const caption = asText(s.caption);
      if (!caption) continue; // a step the student cannot read is not a step

      const place: Record<string, Partial<ScenePlacement>> = {};
      if (s.place && typeof s.place === "object") {
        for (const [actorId, rawPos] of Object.entries(s.place as Record<string, unknown>)) {
          if (!seenActorIds.has(actorId) || !rawPos || typeof rawPos !== "object") continue;
          const p = rawPos as Record<string, unknown>;
          const next: Partial<ScenePlacement> = {};
          if (p.x !== undefined) next.x = clamp(asFiniteNumber(p.x, 50), 0, 100);
          if (p.y !== undefined) next.y = clamp(asFiniteNumber(p.y, 50), 0, 100);
          if (p.opacity !== undefined) next.opacity = clamp(asFiniteNumber(p.opacity, 1), 0, 1);
          if (Object.keys(next).length > 0) place[actorId] = next;
        }
      }

      const linkStates: Record<string, number> = {};
      if (s.links && typeof s.links === "object") {
        for (const [linkId, rawStrength] of Object.entries(s.links as Record<string, unknown>)) {
          if (!seenLinkIds.has(linkId)) continue;
          linkStates[linkId] = clamp(asFiniteNumber(rawStrength, 0), 0, 2);
        }
      }

      steps.push({
        caption,
        narration: asText(s.narration) || caption,
        durationMs: clamp(asFiniteNumber(s.durationMs, DEFAULT_STEP_MS), MIN_STEP_MS, MAX_STEP_MS),
        place,
        links: linkStates,
      });
    }
  }
  if (steps.length === 0) return null;

  return {
    title: asText(obj.title) || "Untitled scene",
    actors,
    links,
    steps,
  };
}

// ─── Resolution ──────────────────────────────────────────

/**
 * Expand partial keyframes into absolute per-step state.
 *
 * Steps are authored as CHANGES ("water moves here") because that is how a
 * model describes motion and how an author thinks. The player needs complete
 * state at every step to interpolate between two frames, so positions carry
 * forward until something moves them.
 *
 * Actors never placed in the first step start invisible at centre stage, so a
 * cast member introduced halfway through fades in from where it is put rather
 * than jumping from a corner.
 */
export function resolveScene(scene: Scene): ResolvedScene {
  const current: Record<string, ScenePlacement> = {};
  for (const actor of scene.actors) {
    current[actor.id] = { x: 50, y: 50, opacity: 0 };
  }
  const currentLinks: Record<string, number> = {};
  for (const link of scene.links) currentLinks[link.id] = 0;

  const frames: ResolvedFrame[] = scene.steps.map((step) => {
    for (const [actorId, partial] of Object.entries(step.place ?? {})) {
      const at = current[actorId];
      if (!at) continue;
      if (partial.x !== undefined) at.x = partial.x;
      if (partial.y !== undefined) at.y = partial.y;
      // A step that moves an actor without saying otherwise means it to be
      // seen; opacity 0 has to be asked for explicitly.
      at.opacity = partial.opacity !== undefined ? partial.opacity : 1;
    }
    for (const [linkId, strength] of Object.entries(step.links ?? {})) {
      if (currentLinks[linkId] !== undefined) currentLinks[linkId] = strength;
    }

    return {
      caption: step.caption,
      narration: step.narration || step.caption,
      durationMs: step.durationMs ?? DEFAULT_STEP_MS,
      place: Object.fromEntries(Object.entries(current).map(([k, v]) => [k, { ...v }])),
      links: { ...currentLinks },
    };
  });

  return { title: scene.title, actors: scene.actors, links: scene.links, frames };
}

/** Total runtime, for a "~N min" badge. */
export function sceneDurationMs(scene: ResolvedScene): number {
  return scene.frames.reduce((sum, f) => sum + f.durationMs, 0);
}

// ─── Anti-slideshow gate ─────────────────────────────────

/**
 * Steps that only fade things in are the failure this whole subsystem exists to
 * kill, so at least this share of the steps after the first must actually MOVE
 * something. Not all of them: dimming everything except the molecule you are
 * naming is real teaching, and the reference SO₂ scene spends two of its six
 * beats doing exactly that. A third is the line between "has spotlight moments"
 * and "is a slideshow with extra steps".
 */
const MIN_ANIMATED_SHARE = 1 / 3;

export interface AnimationCheck {
  animates: boolean;
  /** Steps after the first that move an actor or change a link. */
  animatedSteps: number;
  /** Steps after the first. */
  comparedSteps: number;
}

/**
 * Does this scene actually animate, or does it just change captions?
 *
 * Kept OUT of `validateScene` deliberately. That function answers "is this
 * structurally renderable", and a hand-authored static diagram is a legitimate
 * thing to render. This answers "is this worth calling a video", which is a
 * quality judgement the generator applies to model output — so a model that
 * ignores the prompt's central rule falls through to the next provider instead
 * of shipping the slideshow we set out to replace.
 *
 * Opacity changes deliberately do NOT count as animation. "Everything fades in
 * while the caption changes" is precisely the thing being rejected.
 */
export function checkSceneAnimates(scene: Scene): AnimationCheck {
  const frames = resolveScene(scene).frames;
  const comparedSteps = Math.max(0, frames.length - 1);
  if (comparedSteps === 0) {
    return { animates: false, animatedSteps: 0, comparedSteps: 0 };
  }

  let animatedSteps = 0;
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];

    const moved = Object.entries(curr.place).some(([id, pos]) => {
      const before = prev.place[id];
      if (!before) return false;
      // Sub-pixel drift is not motion a student can see.
      return Math.abs(before.x - pos.x) > 0.5 || Math.abs(before.y - pos.y) > 0.5;
    });

    const relinked = Object.entries(curr.links).some(
      ([id, strength]) => Math.abs((prev.links[id] ?? 0) - strength) > 0.01
    );

    if (moved || relinked) animatedSteps++;
  }

  return {
    animates: animatedSteps / comparedSteps >= MIN_ANIMATED_SHARE,
    animatedSteps,
    comparedSteps,
  };
}
