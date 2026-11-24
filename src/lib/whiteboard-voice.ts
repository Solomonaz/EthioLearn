import crypto from "node:crypto";
import {
  lessonScript,
  practiceScript,
  type LessonKind,
  type LessonPayload,
  type PracticeQuestion,
  type PracticeVoice,
  type Spoken,
  type TutorStyle,
  type WhiteboardLesson,
} from "./whiteboard-lesson";
import { MAX_TTS_CHARS, signLine } from "./tts";

/**
 * Package a lesson for the page: the lesson, the seed for the guide's stock
 * lines, and a signed token for every line of the spoken script — the only
 * text this student may have read aloud by the voice service.
 */
export function lessonPayload(
  userId: string,
  lesson: WhiteboardLesson,
  kind: LessonKind,
  style: TutorStyle = "friendly",
): LessonPayload {
  const seed = crypto.randomInt(1000);
  const tokens = lessonScript(lesson, seed, kind, style).map((l) => signLine(userId, l.say.slice(0, MAX_TTS_CHARS)));
  return { lesson, kind, style, seed, tokens };
}

/**
 * Everything the guide may say in a practice round (reading each question and
 * its choices, reacting to each possible answer), each line signed for this
 * student. Made on every response — stored sets replay with fresh tokens.
 */
export function practiceVoice(userId: string, questions: PracticeQuestion[], style: TutorStyle): PracticeVoice {
  const sign = (text: string): Spoken => {
    const say = text.slice(0, MAX_TTS_CHARS);
    return { say, token: signLine(userId, say) };
  };
  const s = practiceScript(questions, style);
  return {
    intro: sign(s.intro),
    questions: s.questions.map((q) => ({
      read: sign(q.read),
      choices: sign(q.choices),
      right: sign(q.right),
      wrong: q.wrong.map((w) => (w ? sign(w) : null)),
    })),
    end: { great: sign(s.end.great), ok: sign(s.end.ok), low: sign(s.end.low) },
  };
}
