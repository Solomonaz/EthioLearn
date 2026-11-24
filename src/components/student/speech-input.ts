/**
 * Talking to the guide: the browser's own speech recognition (Chrome, Edge,
 * Safari, Android). No audio reaches our server or an AI service — the page
 * only gets the words. Where the browser has none, the page shows typing /
 * tapping instead.
 */

import { speakMath } from "@/lib/whiteboard-lesson";

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechInputSupported(): boolean {
  return !!ctor();
}

/**
 * Listen for one thing said. `onText` gets the words as they come (final =
 * the student stopped talking); `onEnd` always runs last. Returns a stop.
 */
export function listenOnce(opts: {
  onText: (text: string, final: boolean) => void;
  onEnd: (error?: string) => void;
}): () => void {
  const C = ctor();
  if (!C) {
    opts.onEnd("unsupported");
    return () => {};
  }
  let ended = false;
  let error: string | undefined;
  const rec = new C();
  rec.lang = "en-US";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (e.results[i].isFinal) final = true;
    }
    opts.onText(text.trim(), final);
  };
  rec.onerror = (e) => {
    error = e.error;
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    opts.onEnd(error);
  };
  try {
    rec.start();
  } catch {
    ended = true;
    opts.onEnd("start-failed");
  }
  // Never listen forever.
  const cap = setTimeout(() => rec.stop(), 12_000);
  return () => {
    clearTimeout(cap);
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
    if (!ended) {
      ended = true;
      opts.onEnd("aborted");
    }
  };
}

/* ── What did they say? ─────────────────────────────────────────── */

const norm = (s: string) =>
  speakMath(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const LETTER_WORDS: Record<string, number> = {
  a: 0, ay: 0, eh: 0, hey: 0,
  b: 1, be: 1, bee: 1, bi: 1,
  c: 2, see: 2, sea: 2, si: 2, she: 2,
  d: 3, dee: 3, de: 3, the: 3, di: 3,
};
const ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, last: 3, one: 0, two: 1, three: 2, four: 3 };

/** Which option (0-3) the student said: "B", "option C", "it's the second one", or the option itself. */
export function parseChoice(said: string, options: string[]): number | null {
  const t = norm(said);
  if (!t) return null;
  const stripped = t
    .replace(/^(?:i think|i choose|i ll go with|i pick|i say|my answer is|the answer is|answer|it s|it is|is it|option|letter|choice|number)\s+/g, "")
    .replace(/^(?:option|letter|choice|answer|number)\s+/, "")
    .replace(/\s+(?:please|i think|right|final answer)$/g, "")
    .trim();
  if (stripped in LETTER_WORDS) return LETTER_WORDS[stripped];
  const ord = /^(?:the\s+)?(first|second|third|fourth|last|one|two|three|four)(?:\s+one)?$/.exec(stripped);
  if (ord) return ORDINALS[ord[1]];
  const explicit = /\b(?:option|letter|answer|choice)\s+([abcd])\b/.exec(t);
  if (explicit) return "abcd".indexOf(explicit[1]);
  // The option's own words.
  const opts = options.map(norm);
  const exact = opts.findIndex((o) => o && (o === stripped || o === t));
  if (exact >= 0) return exact;
  const words = new Set(t.split(" "));
  let best = -1;
  let bestScore = 0;
  opts.forEach((o, k) => {
    const ow = o.split(" ").filter(Boolean);
    if (!ow.length) return;
    const hit = ow.filter((w) => words.has(w)).length / ow.length;
    if (hit > bestScore) {
      bestScore = hit;
      best = k;
    }
  });
  return bestScore >= 0.75 ? best : null;
}

/** Practice-round commands. */
export function parsePracticeCommand(said: string): "repeat" | "next" | "explain" | "stop" | null {
  const t = norm(said);
  if (/\b(?:repeat|again|say that again|one more time|what was the question)\b/.test(t)) return "repeat";
  if (/\b(?:explain|why|show me|i don t get it)\b/.test(t)) return "explain";
  if (/\b(?:next|skip|continue|go on)\b/.test(t)) return "next";
  if (/\b(?:stop|quit|exit|enough)\b/.test(t)) return "stop";
  return null;
}

export type GuideRequest =
  | { kind: "practice"; count: 5 | 10 }
  | { kind: "summarize" }
  | { kind: "explainAll" }
  | { kind: "explainItem"; id: string }
  | { kind: "ask"; text: string };

/** What a student asked the guide on the options page, in their own words. */
export function parseGuideRequest(said: string, itemIds: string[]): GuideRequest | null {
  const raw = said.trim();
  const t = norm(raw);
  if (!t) return null;
  if (/\b(?:questions?|quiz|test me|practice|practise|exercises?)\b/.test(t) && /\b(?:give|make|ask|quiz|test|practi[cs]e|want|some|more|me)\b/.test(t)) {
    return { kind: "practice", count: /\b(?:10|ten)\b/.test(t) ? 10 : 5 };
  }
  if (/\bsummar(?:y|ize|ise)\b/.test(t)) return { kind: "summarize" };
  const item = /\b(?:question|number|problem|exercise)\s+([0-9]+\s?[a-z]?)\b/.exec(t);
  if (item) {
    const want = item[1].replace(/\s+/g, "");
    const id = itemIds.find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === want);
    if (id) return { kind: "explainItem", id };
  }
  if (/^(?:explain|solve|teach me|help me with)(?: (?:it|this|that|all|everything|the whole thing|the first one|this question|this page))?(?: please)?$/.test(t)) {
    return { kind: "explainAll" };
  }
  return { kind: "ask", text: raw.slice(0, 200) };
}
