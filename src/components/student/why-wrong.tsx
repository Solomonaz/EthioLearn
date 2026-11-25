"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Lock, MessageSquare, PenLine, Sparkles } from "lucide-react";
import { MarkdownView } from "@/components/ui/markdown-view";
import { Spinner } from "@/components/ui/spinner";
import { isLocked, useEntitlements } from "@/hooks/use-entitlements";
import { primeSpeech, WhiteboardTutor } from "@/components/student/whiteboard-tutor";

/**
 * The shared Markdown renderer reads maths written as $…$ / $$…$$; models
 * also write \(…\) and \[…\], which would show as raw text. Convert those
 * here (locally, so other pages using the renderer are unaffected).
 */
function mathDelimiters(md: string): string {
  return md
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$$${m}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m}$`);
}

interface Explained {
  response: string;
  textbookId: string;
  chapterId: string;
}

/**
 * "Why was I wrong?" under a wrong answer on the quiz results page: the AI
 * tutor explains this particular mistake (POST /api/ai/why-wrong). Shown only
 * where the AI tutor is available; free students see it locked, like the menu.
 * The explanation is kept for the browser session so reopening the question
 * doesn't spend another tutor message.
 *
 * Beside it, "Whiteboard tutor" opens the same explanation as the Abugida
 * guide's narrated whiteboard lesson (components/student/whiteboard-tutor).
 */
export function WhyWrong({
  quizId,
  questionId,
  questionNumber,
  studentAnswer,
}: {
  quizId: string;
  questionId: string;
  questionNumber?: number;
  studentAnswer?: string;
}) {
  const t = useTranslations("quiz");
  const ent = useEntitlements();
  const cacheKey = `why-wrong-${quizId}-${questionId}`;
  const [data, setData] = useState<Explained | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(cacheKey);
      if (saved) setData(JSON.parse(saved));
    } catch {
      /* storage unavailable */
    }
  }, [cacheKey]);

  if (ent.loading) return null;
  // Each button is its own plan feature: on, sold with a Pro lock (a student
  // who could buy it), or hidden (switched off / not sold to this user).
  const canBuy = ent.isIndependent && ent.pricingEnabled;
  const boardOn = ent.features.whiteboard;
  const whyOn = ent.features.whyWrong;
  const boardLocked = canBuy && isLocked(ent, "whiteboard");
  const whyLocked = canBuy && isLocked(ent, "whyWrong");
  if (!boardOn && !whyOn && !boardLocked && !whyLocked) return null;

  const lockedChip = (label: string) => (
    <Link
      key={label}
      href="/student/billing"
      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-border/40"
    >
      <Lock className="h-3.5 w-3.5" />
      {label}
      <span className="rounded-full bg-secondary/30 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">Pro</span>
    </Link>
  );

  if (!boardOn && !whyOn) {
    return (
      <div className="mt-3 flex flex-wrap gap-2" data-testid="why-wrong-locked">
        {boardLocked && lockedChip(t("whiteboardTutor"))}
        {whyLocked && lockedChip(t("whyWrong"))}
      </div>
    );
  }

  const whiteboardButton = !boardOn ? (boardLocked ? lockedChip(t("whiteboardTutor")) : null) : (
    <button
      type="button"
      onClick={() => {
        primeSpeech();
        setBoard(true);
      }}
      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
      data-testid="whiteboard-button"
    >
      <PenLine className="h-4 w-4" />
      {t("whiteboardTutor")}
    </button>
  );
  const whiteboard = board && (
    <WhiteboardTutor
      request={{ kind: "mistake", quizId, questionId }}
      questionNumber={questionNumber}
      studentAnswer={studentAnswer}
      followUpHref={data ? `/student/tutor?book=${encodeURIComponent(data.textbookId)}&chapter=${encodeURIComponent(data.chapterId)}` : undefined}
      onClose={() => setBoard(false)}
    />
  );

  async function explain() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/why-wrong", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId, questionId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || t("whyWrongError"));
        return;
      }
      const result: Explained = { response: json.response, textbookId: json.textbookId, chapterId: json.chapterId };
      setData(result);
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(result));
      } catch {
        /* storage unavailable */
      }
    } catch {
      setError(t("whyWrongError"));
    } finally {
      setLoading(false);
    }
  }

  if (data) {
    return (
      <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50/60 px-4 py-3" data-testid="why-wrong-answer">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-purple-700">
          <Sparkles className="h-3.5 w-3.5" /> {t("whyWrongTitle")}
        </p>
        <MarkdownView markdown={mathDelimiters(data.response)} />
        <Link
          href={`/student/tutor?book=${encodeURIComponent(data.textbookId)}&chapter=${encodeURIComponent(data.chapterId)}`}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-purple-700 hover:underline"
        >
          <MessageSquare className="h-4 w-4" /> {t("whyWrongFollowUp")}
        </Link>
        {whiteboardButton && <div className="mt-3">{whiteboardButton}</div>}
        {whiteboard}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {whiteboardButton}
      {whyOn ? (
        <button
          type="button"
          onClick={explain}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 disabled:opacity-70"
          data-testid="why-wrong-button"
        >
          {loading ? <Spinner size="sm" /> : <Sparkles className="h-4 w-4" />}
          {loading ? t("whyWrongLoading") : t("whyWrong")}
        </button>
      ) : (
        whyLocked && lockedChip(t("whyWrong"))
      )}
      {error && <p className="w-full text-sm text-error">{error}</p>}
      {whiteboard}
    </div>
  );
}
