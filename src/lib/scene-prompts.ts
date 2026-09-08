import { SCENE_COLORS, ACTOR_KINDS, LINK_STYLES } from "./scene-schema";

/**
 * The prompt that turns a chapter into an animated scene.
 *
 * It lives beside `scene-schema.ts` rather than in `ai-prompts.ts` because it
 * has to describe that schema EXACTLY, and the vocabulary below is interpolated
 * from the schema's own constants. Adding a colour or a primitive there updates
 * the prompt automatically — the two cannot drift, which is the failure mode
 * that would otherwise show up as silently-dropped actors at validation time.
 */

// How much chapter text to ground the scene in. Deliberately small: the model
// needs enough to be accurate about THIS topic, and the whole prompt has to fit
// the smallest provider budget in the chain (Groq's free tier is ~12K tokens
// per minute, shared with the reply).
const SCENE_CONTENT_CHARS = 6000;

export interface SceneGenerationOptions {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  /** Narrow the scene to one idea inside the chapter. */
  topic?: string;
}

export function buildScenePrompt(opts: SceneGenerationOptions): string {
  const { chapterTitle, subject, grade, topic } = opts;
  const content = (opts.content ?? "").slice(0, SCENE_CONTENT_CHARS).trim();

  return `You are a science animator who explains school topics by MOVING OBJECTS on a stage, not by showing bullet points.

TASK: Build one animated scene that teaches ${topic ? `"${topic}"` : `the key idea of "${chapterTitle}"`} to a Grade ${grade} ${subject} student in Ethiopia.

THE SINGLE MOST IMPORTANT RULE
The student must LEARN FROM THE MOVEMENT. Objects must travel, join, split, or change across steps. A scene where things only fade in while captions change is a FAILURE — that is a slideshow, not an animation. Every step after the first must move at least one actor to a new position, or change at least one link.

THE STAGE
- Coordinates are 0–100 on both axes. x = 0 is the far left, x = 100 the far right. y = 0 is the TOP, y = 100 the BOTTOM.
- The stage is wide (about 16:9). Keep actors between x 8–92 and y 12–88 so nothing is clipped.
- Keep at least 8 units between the centres of two circles or they will overlap.

ACTORS (the cast, declared once)
- "id": short unique string, e.g. "S1", "massA", "nucleus".
- "kind": one of ${ACTOR_KINDS.map((k) => `"${k}"`).join(" | ")}.
   • "circle" — a thing: an atom, a cell, a planet, a mass, a charge, a point.
   • "box"    — a labelled block: a term, a container, a stage of a process.
   • "label"  — floating text: a name, a formula, an annotation. No shape drawn.
- "text": what is written on/as it. Keep circles to 1–3 characters ("S", "O", "e⁻"). Labels may be longer.
- "color": one of ${SCENE_COLORS.map((c) => `"${c}"`).join(" | ")}. Use real conventions where they exist — oxygen "red", sulfur "yellow", hydrogen "white", carbon "grey".
- "size": 0.5–2.5, default 1. Hydrogen ~0.7, a large body ~1.5.

LINKS (connections between two actors)
- "id", "from" (actor id), "to" (actor id), optional "style": ${LINK_STYLES.map((s) => `"${s}"`).join(" | ")}, optional "color".
- Use "line" for bonds and connections, "arrow" for force, flow, or direction.
- A link's STRENGTH is set per step: 0 = not there, 1 = single, 2 = double. Changing it from 0→1 draws a bond forming; 1→0 breaks it; 1→2 makes it double.

STEPS (the keyframes — 5 to 8 of them)
- "caption": one short sentence the student READS on screen.
- "narration": the same idea spoken aloud, one or two natural sentences.
- "durationMs": 2200–3600.
- "place": { actorId: { "x": n, "y": n, "opacity": 0–1 } } — where each actor should be AT THE END of this step. Partial: omit an actor and it stays where it was. Use opacity to dim things you are not talking about (0.3) and to hide things not yet introduced (0).
- "links": { linkId: strength } — partial, same idea.
- The FIRST step must place every actor you intend to show, with opacity 0 for any that appear later.

HOW TO USE THIS PER SUBJECT
- Chemistry: atoms as circles, bonds as links. Move molecules together; form and break bonds; migrate atoms. Conserve every atom — the ones you start with are the ones you must end with.
- Physics: masses/charges as circles, forces and motion as "arrow" links. Move the object to show what the force does.
- Biology: structures as circles or boxes; show a process by moving and splitting parts.
- Mathematics: points and shapes as circles, labels for values; move points to show how a quantity changes.
- History/Economics: boxes moving along a sequence, arrows for cause and effect.

ACCURACY IS NOT OPTIONAL
This is a real curriculum. Every fact, formula, direction and quantity must be correct for Grade ${grade}. If the chapter text disagrees with you, follow the chapter text.

WORKED EXAMPLE (shape only — invent your own scene for the real topic)
{
  "title": "A charge moves in an electric field",
  "actors": [
    { "id": "q", "kind": "circle", "text": "+", "color": "orange" },
    { "id": "plate", "kind": "box", "text": "Plate", "color": "grey" },
    { "id": "lblF", "kind": "label", "text": "F = qE", "color": "cyan" }
  ],
  "links": [ { "id": "force", "from": "plate", "to": "q", "style": "arrow", "color": "cyan" } ],
  "steps": [
    { "caption": "A positive charge sits in the field.", "narration": "A positive charge sits at rest inside the electric field.",
      "durationMs": 2600, "place": { "q": { "x": 30, "y": 50 }, "plate": { "x": 12, "y": 50 }, "lblF": { "x": 50, "y": 20, "opacity": 0 } },
      "links": { "force": 0 } },
    { "caption": "The field pushes it with force F = qE.", "narration": "The field pushes the charge with a force equal to q times E.",
      "durationMs": 2800, "place": { "lblF": { "x": 50, "y": 20, "opacity": 1 } }, "links": { "force": 1 } },
    { "caption": "The charge accelerates away from the plate.", "narration": "So the charge accelerates away from the plate.",
      "durationMs": 3000, "place": { "q": { "x": 78, "y": 50 } } }
  ]
}

CHAPTER: ${chapterTitle}
SUBJECT: ${subject} · Grade ${grade}
CHAPTER TEXT:
"""
${content}
"""

Return ONLY the JSON object for the scene. No markdown, no code fences, no commentary.`;
}
