"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Play, X } from "lucide-react";
import { ProBadge, lockedProFeatures, type ProFeatureKey } from "@/components/student/pro-promo";
import type { EntitlementsInfo } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

/**
 * The student coach tour: a welcome card, then a spotlight that walks down
 * the real menu, one feature at a time, with a chat bubble from the "Abugida
 * guide" beside the highlighted item. It ends on today's Daily Challenge, the
 * one thing to do first. Some steps offer a short clean demo clip
 * (public/tour/*.mp4, desktop 16:9 or phone portrait to match the screen),
 * downloaded only when tapped.
 *
 * Desktop: bubble to the right of the menu item, tail pointing at it.
 * Phones: the menu drawer opens (via the "abugida:sidebar" event the
 * dashboard layout listens to) and the bubble sits just below the item, or
 * just above it when there's no room — never on top of it.
 *
 * Shown once per account (POST /api/students/me/onboarding); "App tour" in
 * the menu replays it (/student?tour=1).
 */

interface CoachStep {
  id: string;
  /** Menu label key (nav namespace) used as the bubble title. */
  navKey?: string;
  /** Element to spotlight; none = the centred welcome card. */
  target?: string;
  pro?: ProFeatureKey;
  video?: { name: string; duration: string };
}

// Menu steps are listed in menu order, and are also sorted by their real
// position in the menu at runtime, so the tour always walks straight down.
const menu = (href: string) => `aside a[href="${href}"]`;
const STEPS: CoachStep[] = [
  { id: "welcome" },
  { id: "quiz", navKey: "quiz", target: menu("/student/quiz"), video: { name: "quiz", duration: "0:38" } },
  { id: "exam", navKey: "nationalExam", target: menu("/student/national-exam") },
  { id: "library", navKey: "library", target: menu("/student/library") },
  { id: "work", navKey: "myWork", target: menu("/student/activities") },
  { id: "grapher", navKey: "grapher", target: menu("/student/grapher"), pro: "mathTools", video: { name: "grapher", duration: "0:27" } },
  { id: "geometry", navKey: "geometry", target: menu("/student/geometry"), pro: "mathTools", video: { name: "geometry", duration: "0:45" } },
  { id: "tutor", navKey: "aiTutor", target: menu("/student/tutor"), pro: "aiTutor", video: { name: "tutor", duration: "0:37" } },
  { id: "battle", navKey: "battle", target: menu("/student/battle"), pro: "battle" },
  { id: "ranks", navKey: "leaderboard", target: menu("/student/leaderboard"), pro: "leaderboard" },
  { id: "rewards", navKey: "rewards", target: menu("/student/rewards") },
  { id: "progress", navKey: "myProgress", target: menu("/student/progress") },
  // "||" = in order of preference: the challenge card, else the streak card.
  { id: "daily", target: '[data-tour="daily-challenge"]||[data-tour="streak"]' },
];

const PAD = 6;
const isSidebar = (sel?: string) => !!sel && sel.startsWith("aside");

function useViewport() {
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

/** Live position of the highlighted element (follows scroll, resize, drawer). */
function useTargetRect(selector: string | undefined, key: number) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let raf = 0;
    const find = () => {
      // First visible match, trying each "||" alternative in order.
      for (const sel of selector.split("||")) {
        const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.getClientRects().length > 0);
        if (el) return el;
      }
      return null;
    };
    const measure = () => {
      const el = find();
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const place = () => {
      // Centre it on phones (and for page cards) so the bubble has room above or below.
      find()?.scrollIntoView({ block: window.innerWidth < 768 || !isSidebar(selector) ? "center" : "nearest" });
      measure();
    };
    place();
    // The phone drawer slides in over ~200ms; measure again once it has.
    const t1 = setTimeout(place, 260);
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      clearTimeout(t1);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [selector, key]);
  return rect;
}

function GuideAvatar() {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary shadow-md" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-symbol-white.svg" alt="" className="h-6 w-6" />
    </span>
  );
}

/** A clean demo clip, as large as the screen allows, in its own orientation. */
function TourVideo({ name, onClose, label }: { name: string; onClose: () => void; label: string }) {
  const { w, h } = useViewport();
  const portrait = w < 768 || h > w;
  const src = `/tour/${name}-${portrait ? "phone" : "desktop"}.mp4`;
  const poster = src.replace(/\.mp4$/, ".jpg");
  // Phone clips are 390x844 (≈ 9:19.5); desktop clips 16:9.
  const style: React.CSSProperties = portrait
    ? { height: "min(calc(100dvh - 5rem), calc((100vw - 1.5rem) * 844 / 390))", aspectRatio: "390 / 844" }
    : { width: "min(92vw, calc((100dvh - 6rem) * 16 / 9))", aspectRatio: "16 / 9" };
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/85 p-3 sm:p-6" onClick={onClose}>
      <div className="relative overflow-hidden rounded-2xl bg-black shadow-2xl" style={style} onClick={(e) => e.stopPropagation()}>
        <video
          key={src}
          src={src}
          poster={poster}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="h-full w-full object-contain"
          data-testid="tour-video"
        />
        <button
          onClick={onClose}
          className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          aria-label={label}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export interface CoachTourProps {
  name: string;
  grade: number | null;
  ent: EntitlementsInfo;
  /** Today's Daily Challenge chapter, when there is one. */
  challengeChapterId: string | null;
  /** First run (record how it ended) vs a replay from the menu. */
  firstRun: boolean;
  onClose: () => void;
}

export function CoachTour({ name, grade, ent, challengeChapterId, firstRun, onClose }: CoachTourProps) {
  const t = useTranslations("onboarding");
  const tn = useTranslations("nav");
  const { w: vw, h: vh } = useViewport();
  const mobile = vw < 768;

  // Only steps whose menu item exists for this student, in the order the
  // items actually sit in the menu. The menu changes after load (while the
  // plan loads every item shows, then some disappear), so this is re-read
  // whenever the menu changes, and the current step is tracked by id.
  const [menuTick, setMenuTick] = useState(0);
  useEffect(() => {
    const aside = document.querySelector("aside");
    if (!aside) return;
    const mo = new MutationObserver(() => setMenuTick((t) => t + 1));
    mo.observe(aside, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  const steps = useMemo<CoachStep[]>(() => {
    if (typeof document === "undefined") return STEPS;
    const menuSteps = STEPS.filter((s) => isSidebar(s.target) && document.querySelector(s.target!));
    menuSteps.sort((a, b) => {
      const ea = document.querySelector(a.target!)!;
      const eb = document.querySelector(b.target!)!;
      return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });
    return [STEPS[0], ...menuSteps, ...STEPS.filter((s) => s.target && !isSidebar(s.target))];
  }, [menuTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const [stepId, setStepId] = useState("welcome");
  // If the current step's item disappeared, carry on with the next one.
  let index = steps.findIndex((s) => s.id === stepId);
  if (index < 0) {
    const order = STEPS.findIndex((s) => s.id === stepId);
    index = steps.findIndex((s) => STEPS.indexOf(s) > order);
    if (index < 0) index = steps.length - 1;
  }
  const setIndex = (next: number | ((i: number) => number)) => {
    const i = typeof next === "function" ? next(index) : next;
    setStepId(steps[Math.max(0, Math.min(i, steps.length - 1))].id);
  };
  const [video, setVideo] = useState<string | null>(null);
  const step = steps[index];
  const last = index >= steps.length - 1;
  const rect = useTargetRect(step.target, STEPS.indexOf(step));
  const locked = useMemo(() => lockedProFeatures(ent), [ent]);
  const recorded = useRef(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleH, setBubbleH] = useState(260);
  const primaryRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (bubbleRef.current && bubbleRef.current.offsetHeight !== bubbleH) setBubbleH(bubbleRef.current.offsetHeight);
  });

  // Phones: the menu is a drawer — open while pointing into it, closed otherwise.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("abugida:sidebar", { detail: { open: isSidebar(step.target) } }));
  }, [step.target]);

  useEffect(() => {
    primaryRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus({ preventScroll: true });
  }, [index, rect === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // No page scroll behind the tour (it scrolls the highlighted item into view itself).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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
      window.dispatchEvent(new CustomEvent("abugida:sidebar", { detail: { open: false } }));
      onClose();
    },
    [record, onClose],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (video) {
        if (e.key === "Escape") setVideo(null);
        return;
      }
      if (e.key === "Escape") close(last ? "complete" : "skip");
      else if (e.key === "ArrowRight" && !last) setIndex((i) => i + 1);
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, last, video]);

  const first = (name || "").trim().split(/\s+/)[0];
  const isLocked = !!step.pro && locked.has(step.pro);
  const challengeHref = challengeChapterId
    ? `/student/quiz?challenge=true&chapterId=${challengeChapterId}&count=5`
    : "/student/quiz";
  // Bubble title (the welcome card builds its own greeting with the name).
  const title = step.navKey ? tn(step.navKey) : step.target ? t(`${step.id}Title`) : "";
  const text =
    step.id === "quiz" && grade ? t("quizTextGrade", { grade }) : t(`${step.id}Text`);

  // ── Bubble placement ────────────────────────────────────────────────────
  let bubbleStyle: React.CSSProperties = {};
  let tail: { side: "left" | "up" | "down"; pos: number } | null = null;
  if (rect && step.target) {
    if (mobile || !isSidebar(step.target)) {
      // Below the target when it fits, otherwise above — never on top of it.
      const gap = 14;
      const width = Math.min(vw - 24, 440);
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, vw - width - 12));
      const below = vh - (rect.bottom + PAD) - gap - 8;
      const above = rect.top - PAD - gap - 8;
      const arrow = Math.max(20, Math.min(rect.left + rect.width / 2 - left - 8, width - 36));
      if (below >= bubbleH || below >= above) {
        bubbleStyle = { top: Math.min(rect.bottom + PAD + gap, vh - bubbleH - 8), left, width };
        tail = { side: "up", pos: arrow };
      } else {
        bubbleStyle = { top: Math.max(8, rect.top - PAD - gap - bubbleH), left, width };
        tail = { side: "down", pos: arrow };
      }
    } else {
      const mid = rect.top + rect.height / 2;
      const top = Math.min(Math.max(12, mid - 48), vh - bubbleH - 12);
      bubbleStyle = { top, left: rect.right + 20, width: 400 };
      tail = { side: "left", pos: Math.max(18, Math.min(mid - top - 8, bubbleH - 30)) };
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="coach-title" data-testid="coach-tour">
      {/* Dim everything except the spotlight */}
      {step.target && rect ? (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-white/90 transition-all duration-300"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(15, 23, 20, 0.62), 0 0 0 6px rgba(253, 216, 53, 0.55)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(15,23,20,0.62)]" />
      )}

      {/* Welcome card */}
      {!step.target && (
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-surface p-6 shadow-2xl sm:p-8">
            <div className="flex items-start gap-3">
              <GuideAvatar />
              <div className="flex-1 rounded-2xl rounded-tl-sm bg-primary/5 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{t("guideName")}</p>
                <p id="coach-title" className="mt-1 text-lg font-bold text-text-primary">
                  {first ? t("welcomeTitle", { name: first }) : t("welcomeTitleNoName")}
                </p>
                <p className="mt-1 text-[15px] leading-relaxed text-text-secondary">{text}</p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" ref={primaryRef}>
              <button onClick={() => close("skip")} className="rounded-xl px-5 py-3 text-sm font-medium text-text-secondary hover:bg-border/40">
                {t("skip")}
              </button>
              <button
                data-primary
                onClick={() => setIndex(1)}
                className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
              >
                {t("showMeAround")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Coach-mark bubble */}
      {step.target && rect && (
        <div className="fixed" style={bubbleStyle} ref={bubbleRef} data-testid="coach-bubble">
          <div className="relative rounded-2xl bg-surface p-5 shadow-2xl">
            {tail && (
              <span
                className={cn(
                  "absolute h-4 w-4 rotate-45 rounded-[3px] bg-surface",
                  tail.side === "left" && "-left-[8px]",
                  tail.side === "up" && "-top-[7px]",
                  tail.side === "down" && "-bottom-[7px]",
                )}
                style={tail.side === "left" ? { top: tail.pos } : { left: tail.pos }}
                aria-hidden
              />
            )}
            <div className="flex items-center gap-3">
              <GuideAvatar />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{t("guideName")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <p id="coach-title" className="text-lg font-bold leading-tight text-text-primary">
                    {title}
                  </p>
                  {isLocked && <ProBadge />}
                </div>
              </div>
              <button
                onClick={() => close(last ? "complete" : "skip")}
                aria-label={t("closeTour")}
                className="self-start rounded-md p-1 text-text-secondary hover:bg-border/40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 rounded-2xl rounded-tl-sm bg-primary/5 px-4 py-3 text-[15px] leading-relaxed text-text-primary">
              {text}
            </p>
            {isLocked && <p className="mt-2 text-xs text-text-secondary">{t("proNote")}</p>}
            {step.video && (
              <button
                onClick={() => setVideo(step.video!.name)}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/15"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                  <Play className="ml-0.5 h-3 w-3 fill-white text-white" />
                </span>
                {t("watchHow", { duration: step.video.duration })}
              </button>
            )}
            <div className="mt-4 flex items-center justify-between gap-3" ref={primaryRef}>
              <div className="flex gap-1" aria-hidden>
                {steps.slice(1).map((s, i) => (
                  <span key={s.id} className={cn("h-1.5 rounded-full transition-all", i + 1 === index ? "w-5 bg-primary" : "w-1.5 bg-border")} />
                ))}
              </div>
              <span className="sr-only" aria-live="polite">
                {t("stepOf", { current: index, total: steps.length - 1 })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-text-secondary hover:bg-border/40"
                >
                  {t("back")}
                </button>
                {last ? (
                  <Link
                    href={challengeHref}
                    onClick={() => close("complete")}
                    data-primary
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
                  >
                    {challengeChapterId ? t("startChallenge") : t("startQuiz")}
                  </Link>
                ) : (
                  <button
                    data-primary
                    onClick={() => setIndex((i) => i + 1)}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
                  >
                    {t("next")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {video && <TourVideo name={video} onClose={() => setVideo(null)} label={t("closeVideo")} />}
    </div>,
    document.body,
  );
}
