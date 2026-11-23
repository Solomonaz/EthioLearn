"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Bell,
  BookOpen,
  Check,
  FileCheck2,
  Flame,
  MessageSquare,
  Play,
  Rocket,
  Sparkles,
  Swords,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProBadge, lockedProFeatures, type ProFeatureKey } from "@/components/student/pro-promo";
import type { EntitlementsInfo } from "@/hooks/use-entitlements";
import { enablePush, notificationPermission, pushSupported } from "@/lib/push-client";
import { cn } from "@/lib/utils";

/**
 * The welcome tour a student sees after signing up: one card per thing they
 * can do, some with a short walk-through video (re-cut from the marketing
 * reels, ~1 MB each, downloaded only when tapped — data is expensive), the
 * rest plain text. It ends on one concrete first step — today's Daily
 * Challenge — because doing something on day one is what brings students
 * back. Shown once per account (POST /api/students/me/onboarding); the
 * sidebar's "App tour" replays it via /student?tour=1.
 */

interface TourVideo {
  src: string;
  poster: string;
  duration: string;
  size: string;
}

interface TourStep {
  id: string;
  icon: LucideIcon;
  color: string;
  pro?: ProFeatureKey;
  video?: TourVideo;
  points?: string[];
}

const STEPS: TourStep[] = [
  { id: "welcome", icon: Sparkles, color: "bg-primary/10 text-primary" },
  { id: "daily", icon: Flame, color: "bg-orange-100 text-orange-600", points: ["dailyPoint1", "dailyPoint2"] },
  {
    id: "quiz",
    icon: BookOpen,
    color: "bg-green-100 text-green-700",
    points: ["quizPoint1", "quizPoint2"],
    video: { src: "/onboarding/quiz.mp4", poster: "/onboarding/quiz.jpg", duration: "1:10", size: "1 MB" },
  },
  {
    id: "tutor",
    icon: MessageSquare,
    color: "bg-purple-100 text-purple-700",
    pro: "aiTutor",
    points: ["tutorPoint1", "tutorPoint2"],
    video: { src: "/onboarding/tutor.mp4", poster: "/onboarding/tutor.jpg", duration: "0:54", size: "1 MB" },
  },
  {
    id: "battle",
    icon: Swords,
    color: "bg-sky-100 text-sky-700",
    pro: "battle",
    points: ["battlePoint1", "battlePoint2"],
    video: { src: "/onboarding/battle.mp4", poster: "/onboarding/battle.jpg", duration: "1:05", size: "1.5 MB" },
  },
  { id: "exam", icon: FileCheck2, color: "bg-amber-100 text-amber-700", points: ["examPoint1", "examPoint2"] },
  { id: "ranks", icon: Trophy, color: "bg-yellow-100 text-yellow-700", pro: "leaderboard", points: ["ranksPoint1"] },
  { id: "ready", icon: Rocket, color: "bg-primary/10 text-primary" },
];

export interface WelcomeTourProps {
  name: string;
  grade: number | null;
  ent: EntitlementsInfo;
  /** Today's Daily Challenge chapter, when there is one. */
  challengeChapterId: string | null;
  /** Reminders already reach this student (Telegram or push). */
  remindersReachable: boolean;
  /** First run (record the outcome) vs a replay from the menu. */
  firstRun: boolean;
  onClose: () => void;
}

function TourVideoPlayer({ video, label, meta, note }: { video: TourVideo; label: string; meta: string; note: string }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <div className="mx-auto w-full max-w-[260px] overflow-hidden rounded-xl bg-black shadow-md">
        {/* Captions are burned into the video. */}
        <video
          src={video.src}
          poster={video.poster}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="aspect-[9/16] max-h-[52vh] w-full object-contain"
          data-testid="tour-video"
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="group relative w-full max-w-[200px] overflow-hidden rounded-xl border border-border shadow-sm"
        aria-label={label}
      >
        <img src={video.poster} alt="" className="aspect-[9/16] max-h-[34vh] w-full object-cover object-top opacity-90" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/35">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-lg">
            <Play className="ml-1 h-6 w-6 fill-primary text-primary" />
          </span>
        </span>
      </button>
      <p className="text-sm font-medium text-primary">{label}</p>
      <p className="text-xs text-text-secondary">{meta}</p>
      <p className="text-[11px] text-text-secondary/80">{note}</p>
    </div>
  );
}

export function WelcomeTour({
  name,
  grade,
  ent,
  challengeChapterId,
  remindersReachable,
  firstRun,
  onClose,
}: WelcomeTourProps) {
  const t = useTranslations("onboarding");
  const [index, setIndex] = useState(0);
  const [reminded, setReminded] = useState(remindersReachable);
  const [remindBusy, setRemindBusy] = useState(false);
  const [remindMsg, setRemindMsg] = useState<string | null>(null);
  const [canPush, setCanPush] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const recorded = useRef(false);

  const locked = useMemo(() => lockedProFeatures(ent), [ent]);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const firstName = (name || "").trim().split(/\s+/)[0] || "";

  useEffect(() => {
    setCanPush(pushSupported() && notificationPermission() !== "denied");
  }, []);

  useEffect(() => {
    // Each step starts at its top, not where the last one was scrolled to.
    bodyRef.current?.scrollTo({ top: 0 });
    // Focus the primary action so Enter moves on (keyboard users).
    footerRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [index]);

  const record = useCallback(
    (action: "complete" | "skip") => {
      if (!firstRun || recorded.current) return;
      recorded.current = true;
      fetch("/api/students/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, step: index }),
        keepalive: true,
      }).catch(() => {});
    },
    [firstRun, index],
  );

  const close = useCallback(
    (action: "complete" | "skip") => {
      record(action);
      onClose();
    },
    [record, onClose],
  );

  // Keyboard: Esc closes, arrows move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(last ? "complete" : "skip");
      else if (e.key === "ArrowRight" && !last) setIndex((i) => Math.min(i + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, last]);

  // No page scroll behind the dialog.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function turnOnReminders() {
    setRemindBusy(true);
    setRemindMsg(null);
    try {
      const status = await fetch("/api/students/me/reminders").then((r) => (r.ok ? r.json() : null));
      const key: string | null = status?.push?.vapidPublicKey ?? null;
      if (!key) {
        setRemindMsg(t("remindError"));
        return;
      }
      const result = await enablePush(key);
      if (result === "ok") setReminded(true);
      else setRemindMsg(result === "denied" ? t("remindDenied") : t("remindError"));
    } finally {
      setRemindBusy(false);
    }
  }

  const Icon = step.icon;
  const isLocked = !!step.pro && locked.has(step.pro);
  const title =
    step.id === "welcome"
      ? t("welcomeTitle", { name: firstName })
      : t(`${step.id}Title`);
  const body =
    step.id === "welcome"
      ? grade
        ? t("welcomeBody", { grade })
        : t("welcomeBodyNoGrade")
      : t(`${step.id}Body`);
  const challengeHref = challengeChapterId
    ? `/student/quiz?challenge=true&chapterId=${challengeChapterId}&count=5`
    : "/student/quiz";

  // Portalled to <body>: inside the page it would share the main column's
  // stacking context, and the fixed mobile bottom bar would paint over it.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      data-testid="welcome-tour"
    >
      <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:max-h-[92vh] sm:max-w-md sm:rounded-2xl">
        {/* Header: progress + skip */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= index ? "bg-primary" : "bg-border")}
              />
            ))}
          </div>
          <span className="text-xs text-text-secondary" aria-live="polite">
            {t("stepOf", { current: index + 1, total: STEPS.length })}
          </span>
          {!last && (
            <button
              type="button"
              onClick={() => close("skip")}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-border/40 hover:text-text-primary"
            >
              {t("skip")}
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex items-start gap-3">
            <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", step.color)}>
              <Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 id="tour-title" className="text-lg font-bold leading-tight text-text-primary">
                  {title}
                </h2>
                {isLocked && <ProBadge />}
              </div>
              <p className="mt-1 text-sm text-text-secondary">{body}</p>
            </div>
          </div>

          {step.id === "welcome" && (
            <ul className="mt-4 space-y-2">
              {(["welcomeList1", "welcomeList2", "welcomeList3", "welcomeList4"] as const).map((k) => (
                <li key={k} className="flex items-center gap-2 text-sm text-text-primary">
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                  {t(k)}
                </li>
              ))}
            </ul>
          )}

          {step.points && (
            <ul className="mt-4 space-y-2">
              {step.points.map((k) => (
                <li key={k} className="flex items-start gap-2 text-sm text-text-primary">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {t(k)}
                </li>
              ))}
            </ul>
          )}

          {isLocked && <p className="mt-3 text-xs text-text-secondary">{t("proNote")}</p>}

          {step.video && (
            <div className="mt-5">
              <TourVideoPlayer
                key={step.id}
                video={step.video}
                label={t("watch")}
                meta={t("watchMeta", { duration: step.video.duration, size: step.video.size })}
                note={t("videoNote")}
              />
            </div>
          )}

          {last && (
            <div className="mt-5 rounded-xl border border-border bg-primary/5 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Bell className="h-4 w-4 text-primary" />
                {t("remindTitle")}
              </p>
              <p className="mt-1 text-xs text-text-secondary">{t("remindBody")}</p>
              {reminded ? (
                <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-green-700">
                  <Check className="h-4 w-4" /> {t("remindDone")}
                </p>
              ) : canPush ? (
                <Button size="sm" variant="outline" className="mt-3" onClick={turnOnReminders} isLoading={remindBusy}>
                  {t("remindOn")}
                </Button>
              ) : (
                <p className="mt-2 text-xs text-text-secondary">{t("remindTelegram")}</p>
              )}
              {remindMsg && <p className="mt-2 text-xs text-error">{remindMsg}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div ref={footerRef} className="border-t border-border px-4 py-3">
          {last ? (
            <div className="flex flex-col gap-2">
              <Link href={challengeHref} onClick={() => record("complete")} className="block">
                <Button className="w-full" size="lg" data-primary>
                  {challengeChapterId ? t("startChallenge") : t("startQuiz")}
                </Button>
              </Link>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setIndex((i) => i - 1)}>
                  {t("back")}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => close("complete")}>
                  {t("explore")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {index > 0 && (
                <Button variant="ghost" className="flex-1" onClick={() => setIndex((i) => i - 1)}>
                  {t("back")}
                </Button>
              )}
              <Button data-primary className="flex-1" onClick={() => setIndex((i) => i + 1)}>
                {t("next")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
