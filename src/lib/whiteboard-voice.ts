import crypto from "node:crypto";
import { lessonScript, type LessonKind, type LessonPayload, type WhiteboardLesson } from "./whiteboard-lesson";
import { MAX_TTS_CHARS, signLine } from "./tts";

/**
 * Package a lesson for the page: the lesson, the seed for the guide's stock
 * lines, and a signed token for every line of the spoken script — the only
 * text this student may have read aloud by the voice service.
 */
export function lessonPayload(userId: string, lesson: WhiteboardLesson, kind: LessonKind): LessonPayload {
  const seed = crypto.randomInt(1000);
  const tokens = lessonScript(lesson, seed, kind).map((l) => signLine(userId, l.say.slice(0, MAX_TTS_CHARS)));
  return { lesson, kind, seed, tokens };
}
