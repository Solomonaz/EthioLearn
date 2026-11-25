"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpenText, ChevronLeft, FileText, ListChecks, MessageCircleQuestion, Mic, MicOff, PenLine, Sparkles, Trash2, ZoomIn, ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import { GuideSays } from "@/components/student/guide-mascot";
import { PdfReader } from "@/components/student/pdf-reader";
import { PracticeQuiz, type PracticeResume } from "@/components/student/practice-quiz";
import { primeSpeech, WhiteboardTutor } from "@/components/student/whiteboard-tutor";
import { listenOnce, parseGuideRequest, speechInputSupported } from "@/components/student/speech-input";
import { useEntitlements } from "@/hooks/use-entitlements";
import type { PracticeQuestion, PracticeVoice, UploadAnalysis } from "@/lib/whiteboard-lesson";

interface StoredResult {
  key: string;
  kind: "lesson" | "practice";
  action: string;
  target: string | null;
  title: string;
  payload: { questions?: PracticeQuestion[] };
}

interface UploadInfo {
  id: string;
  name: string;
  mime: string;
  pages: number | null;
  analysis: UploadAnalysis | null;
  results: StoredResult[];
}

interface PracticeSet {
  questions: PracticeQuestion[];
  voice: PracticeVoice | null;
  /** The stored set (for explaining a missed question from it). */
  key: string | null;
}

type View =
  | { mode: "menu" }
  | { mode: "lesson"; action: "explain" | "summarize"; target: string | null }
  | { mode: "practice"; set: PracticeSet; resume: PracticeResume }
  /** A missed practice question on the board; then back to the round at `resume`. */
  | { mode: "missed"; set: PracticeSet; index: number; picked: number; resume: PracticeResume };

/** A photo, zoomable, scrolling inside its pane. */
function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-1 border-b border-border px-3 py-1.5">
        <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="rounded-md p-1.5 text-text-secondary hover:bg-border/50" aria-label="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-12 text-center text-xs text-text-secondary">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} className="rounded-md p-1.5 text-text-secondary hover:bg-border/50" aria-label="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-gray-100 p-3 dark:bg-gray-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="mx-auto block rounded-lg bg-white shadow" data-testid="study-image" />
      </div>
    </div>
  );
}

/**
 * /student/tutor/whiteboard/study/[id] — one uploaded file, two panes:
 * the file on the left (a PDF is readable page by page), the Abugida guide
 * on the right. The guide first asks what the student wants — explain a
 * question it found, explain everything, summarize, or make practice
 * questions — then does it on the whiteboard. Phones switch panes with tabs.
 */
export default function StudyUploadPage() {
  const t = useTranslations("whiteboard");
  const ent = useEntitlements();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [view, setView] = useState<View>({ mode: "menu" });
  const [tab, setTab] = useState<"file" | "guide">("guide");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [canTalk, setCanTalk] = useState(false);
  const [listening, setListening] = useState(false);
  const [heardNothing, setHeardNothing] = useState(false);
  const stopListen = useRef<(() => void) | null>(null);
  const allowed = ent.features.whiteboard;

  useEffect(() => {
    setCanTalk(speechInputSupported());
    return () => stopListen.current?.();
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/study-uploads/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setNotFound(true);
      return null;
    }
    const d = (await res.json()) as UploadInfo;
    setInfo(d);
    return d;
  }, [id]);

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisFailed(false);
    try {
      const res = await fetch(`/api/study-uploads/${encodeURIComponent(id)}/analyze`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.analysis) throw new Error();
      setInfo((prev) => (prev ? { ...prev, analysis: d.analysis } : prev));
    } catch {
      setAnalysisFailed(true);
    } finally {
      setAnalyzing(false);
    }
  }, [id]);

  useEffect(() => {
    if (ent.loading || !allowed) return;
    load().then((d) => {
      if (d && !d.analysis) analyze();
    });
  }, [ent.loading, allowed, load, analyze]);

  if (!ent.loading && !allowed) {
    return <UpgradeNotice feature="whiteboard" planName={ent.planName} description={t("pitch")} />;
  }

  if (notFound) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <GuideSays expression="concerned" size={90}>{t("uploadGone")}</GuideSays>
        <Link href="/student/tutor/whiteboard" className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark">
          {t("backToWhiteboard")}
        </Link>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  const fileUrl = `/api/study-uploads/${encodeURIComponent(info.id)}/file`;
  const isPdf = info.mime === "application/pdf";
  const a = info.analysis;
  const questions = a && (a.kind === "questions" || a.kind === "mixed") ? a.items : [];
  const topics = a && a.kind === "notes" ? a.items : [];

  const startLesson = (action: "explain" | "summarize", target: string | null) => {
    primeSpeech();
    setActError(null);
    setTab("guide");
    setView({ mode: "lesson", action, target });
  };

  const startPractice = async (count: 5 | 10, target: string | null = null) => {
    primeSpeech();
    setBusy(true);
    setActError(null);
    setTab("guide");
    try {
      const res = await fetch(`/api/study-uploads/${encodeURIComponent(info.id)}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "practice", count, ...(target ? { target } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(d.questions)) throw new Error(d.error || t("error"));
      setView({
        mode: "practice",
        set: { questions: d.questions, voice: d.voice ?? null, key: typeof d.key === "string" ? d.key : null },
        resume: { index: 0, score: 0 },
      });
      load();
    } catch (e) {
      setActError(e instanceof Error ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  };

  const backToMenu = () => {
    setView({ mode: "menu" });
    load();
  };

  /** The student talked to the guide on the options page. */
  const talk = () => {
    if (listening) {
      stopListen.current?.();
      return;
    }
    primeSpeech();
    setHeardNothing(false);
    setListening(true);
    let handled = false;
    stopListen.current = listenOnce({
      onText: (text, final) => {
        setAsk(text.slice(0, 200));
        if (!final || handled) return;
        handled = true;
        const r = parseGuideRequest(text, questions.map((x) => x.id));
        if (!r) return;
        if (r.kind === "practice") startPractice(r.count);
        else if (r.kind === "summarize") startLesson("summarize", null);
        else if (r.kind === "explainAll") startLesson("explain", null);
        else if (r.kind === "explainItem") {
          const item = questions.find((x) => x.id === r.id)!;
          startLesson("explain", `Question ${item.id}: ${item.label}`.slice(0, 200));
        } else startLesson("explain", r.text);
      },
      onEnd: () => {
        stopListen.current = null;
        setListening(false);
        if (!handled) setHeardNothing(true);
      },
    });
  };

  const remove = async () => {
    if (!window.confirm(t("deleteConfirm"))) return;
    await fetch(`/api/study-uploads/${encodeURIComponent(info.id)}`, { method: "DELETE" });
    router.push("/student/tutor/whiteboard");
  };

  const chip =
    "inline-flex max-w-full items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-text-primary hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60";

  const menu = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface" data-testid="study-menu">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <GuideSays expression={analyzing ? "thinking" : "happy"} size={72}>
          {analyzing ? t("reading") : a?.kind === "other" ? t("notSchoolwork") : t("whatToDo")}
        </GuideSays>

        {analysisFailed && (
          <p className="text-sm text-error">
            {t("readFailed")}{" "}
            <button type="button" onClick={analyze} className="font-semibold underline">
              {t("tryAgain")}
            </button>
          </p>
        )}

        {/* Questions the guide found */}
        {questions.length > 0 && (
          <section className="space-y-2" data-testid="study-questions">
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
              {t("foundQuestions", { count: questions.length })}
            </p>
            <div className="grid gap-2">
              {questions.map((q) => (
                <button
                  key={q.id + q.label}
                  type="button"
                  onClick={() => startLesson("explain", `Question ${q.id}: ${q.label}`.slice(0, 200))}
                  className={chip}
                  data-testid="study-question"
                >
                  <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">{q.id}</span>
                  <span className="min-w-0 flex-1">{q.label}</span>
                  <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Topics of a note */}
        {topics.length > 0 && (
          <section className="space-y-2" data-testid="study-topics">
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{t("foundTopics")}</p>
            <div className="flex flex-wrap gap-2">
              {topics.map((q) => (
                <button
                  key={q.id + q.label}
                  type="button"
                  onClick={() => startLesson("explain", `Topic: ${q.label}`.slice(0, 200))}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-text-primary hover:border-primary/50 hover:bg-primary/5"
                  data-testid="study-topic"
                >
                  <PenLine className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">{q.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Main actions */}
        <section className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{t("orChoose")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => startLesson("explain", null)} className={chip} data-testid="study-explain-all">
              <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{topics.length > 0 || a?.kind === "notes" ? t("explainNote") : questions.length > 1 ? t("explainFirst") : t("explainIt")}</span>
            </button>
            <button type="button" onClick={() => startLesson("summarize", null)} className={chip} data-testid="study-summarize">
              <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{t("summarize")}</span>
            </button>
            <button type="button" onClick={() => startPractice(5)} disabled={busy} className={chip} data-testid="study-practice-5">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{t("practiceN", { count: 5 })}</span>
            </button>
            <button type="button" onClick={() => startPractice(10)} disabled={busy} className={chip} data-testid="study-practice-10">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{t("practiceN", { count: 10 })}</span>
            </button>
          </div>
          {busy && (
            <p className="flex items-center gap-2 text-sm text-text-secondary">
              <Spinner size="sm" /> {t("makingQuestions")}
            </p>
          )}
          {actError && <p className="text-sm text-error" data-testid="study-error">{actError}</p>}
        </section>

        {/* Ask in their own words */}
        <section className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{t("orAsk")}</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ask.trim()) startLesson("explain", ask.trim().slice(0, 200));
            }}
          >
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value.slice(0, 200))}
              placeholder={t("askPlaceholder")}
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-base text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:text-sm"
              data-testid="study-ask"
            />
            {canTalk && (
              <button
                type="button"
                onClick={talk}
                className={cn(
                  "flex w-11 shrink-0 items-center justify-center rounded-xl text-white",
                  listening ? "animate-pulse bg-error" : "bg-primary/90 hover:bg-primary-dark",
                )}
                aria-label={listening ? t("stopListening") : t("talk")}
                aria-pressed={listening}
                title={t("talkHint")}
                data-testid="study-mic"
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <button type="submit" disabled={!ask.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50">
              <MessageCircleQuestion className="h-4 w-4" /> <span className="hidden sm:inline">{t("askGo")}</span>
            </button>
          </form>
          <p className="text-xs text-text-muted" data-testid="study-talk-hint">
            {listening ? t("listening") : heardNothing ? t("didntCatch") : canTalk ? t("talkHint") : null}
            {canTalk ? " " : ""}
            {t("usesMessage")}
          </p>
        </section>

        {/* Done before: replay for free */}
        {info.results.some((r) => r.action !== "explainPractice") && (
          <section className="space-y-2" data-testid="study-done">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-muted">
              <Sparkles className="h-3.5 w-3.5" /> {t("doneBefore")}
            </p>
            <div className="flex flex-wrap gap-2">
              {info.results.filter((r) => r.action !== "explainPractice").map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() =>
                    r.kind === "practice"
                      ? startPractice(/:10$/.test(r.key) ? 10 : 5, r.target)
                      : startLesson(r.action === "summarize" ? "summarize" : "explain", r.target)
                  }
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-primary hover:border-primary/40 hover:bg-primary/5"
                >
                  {r.kind === "practice" ? <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" /> : <PenLine className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  <span className="truncate">{r.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );

  let guide: React.ReactNode;
  if (view.mode === "lesson") {
    guide = (
      <WhiteboardTutor
        key={`${view.action}:${view.target ?? ""}`}
        inline
        request={{ kind: "study", uploadId: info.id, action: view.action, target: view.target }}
        onClose={backToMenu}
      />
    );
  } else if (view.mode === "practice") {
    const { set } = view;
    guide = (
      <PracticeQuiz
        key={`${set.key}:${view.resume.index}`}
        questions={set.questions}
        voice={set.voice}
        startIndex={view.resume.index}
        startScore={view.resume.score}
        onBack={backToMenu}
        onExplain={(question) => startLesson("explain", question.slice(0, 200))}
        onExplainMissed={
          set.key
            ? (index, picked, resume) => {
                primeSpeech();
                setView({ mode: "missed", set, index, picked, resume });
              }
            : undefined
        }
      />
    );
  } else if (view.mode === "missed") {
    const { set, index, picked, resume } = view;
    guide = (
      <WhiteboardTutor
        key={`missed:${set.key}:${index}:${picked}`}
        inline
        request={{ kind: "practice", uploadId: info.id, set: set.key!, index, picked }}
        onClose={() => setView({ mode: "practice", set, resume })}
        closeLabel={resume.index < set.questions.length ? t("backToQuestions") : t("seeScore")}
      />
    );
  } else guide = menu;

  return (
    // Fills the window between the top bar (4rem) and, on phones, the bottom
    // tab bar (5rem), inside the layout's thin frame for this page (p-2 / sm:p-3
    // / lg:p-4, see dashboard-layout "tightPage").
    <div className="flex h-[calc(100dvh-10rem)] flex-col gap-2 sm:h-[calc(100dvh-10.5rem)] md:h-[calc(100dvh-5.5rem)] lg:h-[calc(100dvh-6rem)]" data-testid="study-page">
      <div className="flex shrink-0 items-center gap-2">
        <Link href="/student/tutor/whiteboard" className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-text-secondary hover:bg-border/40 hover:text-primary">
          <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t("title")}</span>
        </Link>
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-text-primary">
          {isPdf && <FileText className="h-4 w-4 shrink-0 text-error" />}
          <span className="truncate">{a?.title || info.name}</span>
        </span>
        <button type="button" onClick={remove} className="ml-auto rounded-full p-2 text-text-muted hover:bg-border/40 hover:text-error" aria-label={t("deleteUpload")} title={t("deleteUpload")}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Phones: one pane at a time */}
      <div className="flex shrink-0 gap-1 rounded-full border border-border bg-surface p-1 text-sm font-semibold lg:hidden" role="tablist">
        {(["file", "guide"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("flex-1 rounded-full px-3 py-1.5", tab === k ? "bg-primary text-white" : "text-text-secondary")}
            data-testid={`study-tab-${k}`}
          >
            {k === "file" ? t("tabFile") : t("tabGuide")}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-3">
        <div
          className={cn("min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface", tab === "file" ? "flex" : "hidden lg:flex")}
          data-testid="study-file-pane"
        >
          {isPdf ? (
            <PdfReader url={fileUrl} storageKey={`study-page-${info.id}`} />
          ) : (
            <ImageViewer src={fileUrl} alt={info.name} />
          )}
        </div>
        <div className={cn("min-h-0 min-w-0 flex-col", tab === "guide" ? "flex" : "hidden lg:flex")} data-testid="study-guide-pane">
          {guide}
        </div>
      </div>
    </div>
  );
}
