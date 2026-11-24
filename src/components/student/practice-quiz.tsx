"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, CheckCircle, Mic, MicOff, PenLine, RotateCcw, Volume2, VolumeX, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/ui/math-text";
import { GuideMascot, GuideSays, type MascotExpression } from "@/components/student/guide-mascot";
import { VoiceTrack, synth } from "@/components/student/voice-player";
import { listenOnce, parseChoice, parsePracticeCommand, speechInputSupported } from "@/components/student/speech-input";
import type { PracticeQuestion, PracticeVoice, Spoken } from "@/lib/whiteboard-lesson";

const LETTERS = ["A", "B", "C", "D"];

/** Once a student talks to the guide, it keeps listening after each question (this visit). */
let handsFreeVisit = false;

export interface PracticeResume {
  index: number;
  score: number;
}

/**
 * Practice questions the guide made from an upload, one at a time — out loud.
 *
 * The guide reads each question and its choices in the lesson voice; the
 * student taps a choice or says it ("B", "option C", the answer itself). The
 * guide reacts (fitting the question when right, dramatic when wrong), then
 * waits: Next, or Explain — right or wrong, since a right answer may be a
 * lucky guess — which works it out on the whiteboard (one tutor message) and
 * comes back to the next question. Nothing jumps to the board by itself.
 * Every spoken line is server-signed (PracticeVoice). Nothing is saved as a
 * graded quiz — it's practice.
 */
export function PracticeQuiz({
  questions,
  voice,
  startIndex = 0,
  startScore = 0,
  onBack,
  onExplain,
  onExplainMissed,
}: {
  questions: PracticeQuestion[];
  /** The guide's signed lines for this set; without them the round is silent. */
  voice?: PracticeVoice | null;
  startIndex?: number;
  startScore?: number;
  onBack: () => void;
  /** Explain this question on the whiteboard (by its text). */
  onExplain: (question: string) => void;
  /** Explain the question the student just missed, then come back at `resume`. */
  onExplainMissed?: (index: number, picked: number, resume: PracticeResume) => void;
}) {
  const t = useTranslations("whiteboard");
  const [i, setI] = useState(Math.min(startIndex, questions.length - 1));
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(startScore);
  const [done, setDone] = useState(startIndex >= questions.length);
  const [phase, setPhase] = useState<"reading" | "waiting" | "reacting" | "feedback">("reading");
  const [line, setLine] = useState<Spoken | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [readNonce, setReadNonce] = useState(0);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [notHeard, setNotHeard] = useState(false);
  const [canTalk, setCanTalk] = useState(false);
  const track = useRef(new VoiceTrack());
  const speechCancel = useRef<(() => void) | null>(null);
  const listenStop = useRef<(() => void) | null>(null);
  const introDone = useRef(startIndex > 0);
  const q = questions[i];
  const qv = voice?.questions[i];

  useEffect(() => {
    setCanTalk(speechInputSupported());
    return () => {
      speechCancel.current?.();
      listenStop.current?.();
      synth()?.cancel();
    };
  }, []);

  /** Say lines one after another (each subtitled), then `then`. */
  const sayAll = useCallback(
    (lines: (Spoken | null | undefined)[], then?: () => void) => {
      speechCancel.current?.();
      const list = lines.filter((l): l is Spoken => !!l);
      let k = 0;
      let cancelled = false;
      let cancel: (() => void) | null = null;
      const step = () => {
        if (cancelled) return;
        if (k >= list.length) {
          setSpeaking(false);
          then?.();
          return;
        }
        const l = list[k++];
        setLine(l);
        setSpeaking(true);
        cancel = track.current.say(l.say, l.token, voiceOn, () => setTimeout(step, 250));
      };
      step();
      speechCancel.current = () => {
        cancelled = true;
        cancel?.();
        setSpeaking(false);
      };
    },
    [voiceOn],
  );

  const stopListening = useCallback(() => {
    listenStop.current?.();
    listenStop.current = null;
    setListening(false);
  }, []);

  const next = useCallback(() => {
    speechCancel.current?.();
    stopListening();
    if (i < questions.length - 1) {
      setI(i + 1);
      setPicked(null);
      setPhase("reading");
      setNotHeard(false);
    } else setDone(true);
  }, [i, questions.length, stopListening]);

  const explainNow = useCallback(
    (k: number, sc: number) => {
      speechCancel.current?.();
      stopListening();
      if (onExplainMissed) onExplainMissed(i, k, { index: i + 1, score: sc });
      else onExplain(q.question);
    },
    [i, q, onExplain, onExplainMissed, stopListening],
  );

  const choose = useCallback(
    (k: number) => {
      if (picked !== null || done) return;
      stopListening();
      speechCancel.current?.();
      setPicked(k);
      const right = k === q.answer;
      const sc = right ? score + 1 : score;
      setScore(sc);
      setPhase("reacting");
      // The guide reacts, then waits: the student chooses Next, or Explain
      // (right or wrong — a right answer may have been a lucky guess).
      const l = right ? qv?.right : qv?.wrong[k];
      if (l) sayAll([l], () => setPhase("feedback"));
      else setPhase("feedback");
    },
    [picked, done, q, qv, score, sayAll, stopListening],
  );

  // Read the question and its choices (the intro first, once).
  useEffect(() => {
    if (done) {
      const great = score >= Math.ceil(questions.length * 0.8);
      const ok = score >= Math.ceil(questions.length * 0.5);
      sayAll([voice ? (great ? voice.end.great : ok ? voice.end.ok : voice.end.low) : null]);
      return () => speechCancel.current?.();
    }
    if (picked !== null) return;
    setPhase("reading");
    const intro = !introDone.current ? voice?.intro : null;
    introDone.current = true;
    sayAll([intro, qv?.read, qv?.choices], () => setPhase("waiting"));
    // Make the next lines ahead of time.
    if (qv) [qv.right, ...qv.wrong].forEach((l) => l && track.current.prefetch(l.say, l.token));
    const nq = voice?.questions[i + 1];
    if (nq) [nq.read, nq.choices].forEach((l) => track.current.prefetch(l.say, l.token));
    return () => speechCancel.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, done, readNonce]);

  const listen = useCallback(() => {
    speechCancel.current?.();
    stopListening();
    setHeard("");
    setNotHeard(false);
    setListening(true);
    let last = "";
    let handled = false;
    listenStop.current = listenOnce({
      onText: (text, final) => {
        last = text;
        setHeard(text);
        if (!final || handled) return;
        handled = true;
        const cmd = parsePracticeCommand(text);
        const choice = picked === null ? parseChoice(text, q.options) : null;
        if (choice !== null && cmd !== "repeat") return choose(choice);
        if (cmd === "repeat") return setReadNonce((n) => n + 1);
        if (cmd === "stop") return onBack();
        if (cmd === "next" && picked !== null) return next();
        if (cmd === "explain" && picked !== null) return explainNow(picked, score);
        setNotHeard(true);
      },
      onEnd: (err) => {
        listenStop.current = null;
        setListening(false);
        if (!handled && (last || (err && err !== "aborted" && err !== "no-speech"))) setNotHeard(true);
      },
    });
  }, [picked, q, choose, next, explainNow, onBack, score, stopListening]);

  // Hands-free: once they've talked, listen after each question is read
  // (for the answer) and after each reaction (for "next" / "explain").
  useEffect(() => {
    if (!handsFreeVisit || !canTalk || done) return;
    if ((phase === "waiting" && picked === null) || (phase === "feedback" && picked !== null)) listen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const micTap = () => {
    if (listening) return stopListening();
    handsFreeVisit = true;
    if (phase === "reading") setPhase("waiting");
    listen();
  };

  const restart = () => {
    setI(0);
    setPicked(null);
    setScore(0);
    setDone(false);
    setReadNonce((n) => n + 1);
  };

  const header = (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 items-center gap-1 rounded-full px-2 text-sm font-semibold text-text-secondary hover:bg-border/50"
        data-testid="practice-back"
      >
        <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t("backToOptions")}</span>
      </button>
      <p className="ml-auto text-sm font-semibold text-text-secondary">
        {done ? t("practiceDone") : t("questionOf", { n: i + 1, total: questions.length })}
      </p>
      {voice && (
        <button
          type="button"
          onClick={() => {
            speechCancel.current?.();
            setVoiceOn((v) => !v);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-border/40"
          aria-label={voiceOn ? t("voiceOff") : t("voiceOn")}
          data-testid="practice-voice"
        >
          {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      )}
    </div>
  );

  if (done) {
    const great = score >= Math.ceil(questions.length * 0.8);
    const ok = score >= Math.ceil(questions.length * 0.5);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface" data-testid="practice-quiz">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <GuideSays expression={great ? "proud" : ok ? "happy" : "concerned"} size={110}>
            {line?.say ?? (great ? t("practiceGreat") : ok ? t("practiceOk") : t("practiceLow"))}
          </GuideSays>
          <p className="text-4xl font-black text-primary" data-testid="practice-score">
            {score}/{questions.length}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={restart} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-border/40">
              <RotateCcw className="h-4 w-4" /> {t("tryAgain")}
            </button>
            <button type="button" onClick={onBack} className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark">
              {t("somethingElse")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const answered = picked !== null;
  const right = answered && picked === q.answer;
  const expr: MascotExpression = answered ? (right ? "proud" : "shocked") : listening ? "thinking" : "happy";
  const reaction = answered ? (right ? qv?.right.say ?? t("practiceRight") : (picked !== null && qv?.wrong[picked]?.say) || t("practiceWrong")) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface" data-testid="practice-quiz">
      {header}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((i + (answered ? 1 : 0)) / questions.length) * 100}%` }} />
        </div>
        <p className="text-base font-semibold leading-relaxed text-text-primary" data-testid="practice-question">
          <MathText text={q.question} />
        </p>
        <div className="space-y-2">
          {q.options.map((o, k) => {
            const isRight = answered && k === q.answer;
            const isWrongPick = answered && k === picked && k !== q.answer;
            return (
              <button
                key={k}
                type="button"
                onClick={() => choose(k)}
                disabled={answered}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-colors",
                  !answered && "border-border hover:border-primary/50 hover:bg-primary/5",
                  isRight && "border-success bg-success/10 font-semibold text-success",
                  isWrongPick && "border-error bg-error/10 text-error",
                  answered && !isRight && !isWrongPick && "border-border opacity-60",
                )}
                data-testid="practice-option"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">{LETTERS[k]}</span>
                <span className="min-w-0 flex-1"><MathText text={o} /></span>
                {isRight && <CheckCircle className="h-5 w-5 shrink-0" />}
                {isWrongPick && <XCircle className="h-5 w-5 shrink-0" />}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="space-y-3" data-testid="practice-feedback">
            <GuideSays expression={right ? "proud" : "shocked"} size={64}>
              <span data-testid="practice-reaction">{reaction}</span>
            </GuideSays>
            {q.explanation && (phase === "feedback" || phase === "reacting") && (
              <p className="rounded-xl bg-primary/5 px-3 py-2 text-sm text-text-primary">
                <MathText text={q.explanation} />
              </p>
            )}
            {phase === "feedback" && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => explainNow(picked!, score)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5"
                  data-testid="practice-explain"
                >
                  <PenLine className="h-4 w-4" /> {t("explainThis")}
                </button>
                <button type="button" onClick={next} className="ml-auto rounded-full bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark" data-testid="practice-next">
                  {i < questions.length - 1 ? t("next") : t("seeScore")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The guide, talking — and the mic to answer out loud. */}
      {/* right padding: room for the floating study-notes button (fixed, bottom-right) */}
      <div className="flex items-center gap-3 border-t border-border py-2 pl-3 pr-[4.5rem]" data-testid="practice-talkbar">
        <GuideMascot expression={expr} talking={speaking} size={44} className="shrink-0" />
        <p className="line-clamp-3 min-w-0 flex-1 text-sm leading-snug text-text-secondary" aria-live="polite" data-testid="practice-subtitle">
          {listening ? (
            <span className="font-medium text-primary">{heard || t("listening")}</span>
          ) : notHeard ? (
            t("didntCatch")
          ) : speaking && line ? (
            line.say
          ) : !answered && phase === "waiting" ? (
            canTalk ? t("sayAnswer") : t("tapAnswer")
          ) : answered && phase === "feedback" ? (
            canTalk ? t("afterAnswerTalk") : t("afterAnswer")
          ) : null}
        </p>
        {!answered && (
          <button
            type="button"
            onClick={() => setReadNonce((n) => n + 1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-border/40"
            aria-label={t("readAgain")}
            title={t("readAgain")}
            data-testid="practice-repeat"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        {canTalk && (
          <button
            type="button"
            onClick={micTap}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow",
              listening ? "animate-pulse bg-error" : "bg-primary hover:bg-primary-dark",
            )}
            aria-label={listening ? t("stopListening") : t("talk")}
            aria-pressed={listening}
            data-testid="practice-mic"
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
      </div>
    </div>
  );
}
