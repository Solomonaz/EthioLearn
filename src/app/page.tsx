import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Wand2,
  Bot,
  Swords,
  Target,
  Trophy,
  Gift,
  Sparkles,
  Check,
  ArrowRight,
  Zap,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { Logo } from "@/components/ui/logo";
import { AiQuizDemo } from "@/components/home/ai-quiz-demo";
import { CountUp } from "@/components/home/count-up";

export default async function HomePage() {
  const t = await getTranslations("home");
  const tc = await getTranslations("common");

  const features = [
    { icon: Wand2, title: t("feature1Title"), desc: t("feature1Desc") },
    { icon: Bot, title: t("feature2Title"), desc: t("feature2Desc") },
    { icon: Swords, title: t("feature3Title"), desc: t("feature3Desc") },
    { icon: Target, title: t("feature4Title"), desc: t("feature4Desc") },
    { icon: Trophy, title: t("feature5Title"), desc: t("feature5Desc") },
    { icon: Gift, title: t("feature6Title"), desc: t("feature6Desc") },
  ];

  const steps = [
    { step: "1", title: t("step1Title"), desc: t("step1Desc") },
    { step: "2", title: t("step2Title"), desc: t("step2Desc") },
    { step: "3", title: t("step3Title"), desc: t("step3Desc") },
  ];

  const subjects = [
    t("biology"), t("mathematics"), t("physics"), t("chemistry"),
    t("english"), t("amharic"), t("history"), t("geography"),
  ];

  const spotlightPoints = [t("spotlightPoint1"), t("spotlightPoint2"), t("spotlightPoint3")];

  // Sample "generated" question stems for the AI-engine spotlight visual.
  const generated = [
    "Define the role of chlorophyll in photosynthesis.",
    "Balance: C₃H₈ + O₂ → CO₂ + H₂O.",
    "Explain Newton's second law with an example.",
    "What causes the seasons in Ethiopia?",
    "Solve for x: 2x + 5 = 17.",
  ];

  return (
    <div className="relative min-h-screen bg-[#060a07] text-white">
      {/* Ambient background — aurora glows + tech grid (viewport-fixed) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="lp-aurora-1 absolute -top-48 left-[15%] h-[560px] w-[560px] rounded-full bg-emerald-500/20 blur-[130px]" />
        <div className="lp-aurora-2 absolute -top-24 right-[12%] h-[460px] w-[460px] rounded-full bg-[#FDD835]/10 blur-[130px]" />
        <div className="absolute bottom-0 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-emerald-600/10 blur-[150px]" />
        <div className="lp-grid absolute inset-x-0 top-0 h-[720px]" />
      </div>

      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#060a07]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" aria-label={tc("appName")}>
            <Logo size="md" onDark />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-white/70 md:flex">
            <a href="#features" className="transition-colors hover:text-white">{t("navFeatures")}</a>
            <a href="#how" className="transition-colors hover:text-white">{t("navHow")}</a>
            <a href="#subjects" className="transition-colors hover:text-white">{t("navSubjects")}</a>
          </nav>
          <div className="flex items-center gap-3">
            <LanguageSwitcher dark />
            <Link href="/login" className="hidden text-sm font-medium text-white/80 transition-colors hover:text-white sm:block">
              {tc("signIn")}
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_22px_-6px_rgba(16,185,129,0.8)] transition hover:shadow-[0_0_30px_-4px_rgba(16,185,129,1)]"
            >
              {tc("getStarted")}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-16 sm:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          {/* Copy */}
          <div className="text-center lg:text-left">
            <div className="lp-fade-up inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-200">
              <span className="relative flex h-2 w-2">
                <span className="lp-blink absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <Sparkles className="h-3.5 w-3.5" />
              {t("aiBadge")}
            </div>

            <h1 className="lp-fade-up mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
              {t("heroTitle")} <span className="lp-text-gradient">{t("heroTitleAccent")}</span>
            </h1>

            <p className="lp-fade-up mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/70 lg:mx-0">
              {t("heroDesc")}
            </p>

            <div className="lp-fade-up mt-9 flex flex-col items-center gap-3 sm:flex-row lg:justify-start sm:justify-center">
              <Link
                href="/register"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-7 py-3.5 text-base font-bold text-white shadow-[0_0_34px_-8px_rgba(16,185,129,0.85)] transition hover:shadow-[0_0_46px_-6px_rgba(16,185,129,1)] sm:w-auto"
              >
                {t("startFree")}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#features"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-7 py-3.5 text-base font-semibold text-white/90 backdrop-blur transition hover:bg-white/[0.08] sm:w-auto"
              >
                {t("exploreFeatures")}
              </a>
            </div>

            <div className="lp-fade-up mt-6 flex items-center justify-center gap-2 text-sm text-white/50 lg:justify-start">
              <Check className="h-4 w-4 text-emerald-400" />
              {t("trustLine")}
            </div>
          </div>

          {/* Animated AI demo + floating chips */}
          <div className="flex justify-center lg:justify-end">
            <div className="lp-float relative">
              <div className="hidden sm:block">
                <div className="lp-float absolute -left-6 top-10 z-20 flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur">
                  <Zap className="h-3.5 w-3.5 text-[#FDD835]" /> +50 XP
                </div>
                <div className="lp-float-slow absolute -bottom-5 -left-8 z-20 flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur">
                  <Trophy className="h-3.5 w-3.5 text-emerald-300" /> Battle won
                </div>
              </div>
              <AiQuizDemo />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-20 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur sm:grid-cols-4">
          {[
            { node: <CountUp to={10000} suffix="+" />, label: t("statQuestions") },
            { node: <CountUp to={10} suffix="+" />, label: t("statSubjects") },
            { node: <>24/7</>, label: t("statTutor") },
            { node: <>7–12</>, label: t("statGrades") },
          ].map((s, i) => (
            <div key={i} className="bg-[#060a07]/40 px-6 py-7 text-center">
              <div className="text-3xl font-black text-emerald-300 sm:text-4xl">{s.node}</div>
              <div className="mt-1.5 text-sm text-white/55">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="relative z-10 border-t border-white/5 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-black tracking-tight sm:text-4xl">
            {t("featuresTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-white/60">{t("featuresSubtitle")}</p>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="lp-ring group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:bg-white/[0.06]"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-400/12 ring-1 ring-emerald-400/20 transition-shadow group-hover:shadow-[0_0_26px_-6px_rgba(16,185,129,0.7)]">
                  <f.icon className="h-6 w-6 text-emerald-300" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-white/60">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI engine spotlight ── */}
      <section className="relative z-10 py-10">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid items-center gap-10 rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/[0.12] via-white/[0.02] to-[#FDD835]/[0.06] p-8 sm:p-12 lg:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                <Sparkles className="h-3.5 w-3.5" />
                {t("spotlightBadge")}
              </div>
              <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                {t("spotlightTitle")}
              </h2>
              <p className="mt-4 text-white/70">{t("spotlightDesc")}</p>
              <ul className="mt-6 space-y-3">
                {spotlightPoints.map((p) => (
                  <li key={p} className="flex items-center gap-3 text-white/85">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            {/* Static "generated" output card */}
            <div className="lp-ring rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <Wand2 className="h-4 w-4 text-emerald-300" />
                <span className="text-sm text-white/80">Generate a quiz from any chapter</span>
              </div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300">
                <Sparkles className="h-3 w-3" /> Generated · 5 questions
              </div>
              <ul className="space-y-2">
                {generated.map((q, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/80"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-400/15 text-[10px] font-bold text-emerald-300">
                      {i + 1}
                    </span>
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="relative z-10 border-t border-white/5 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-black tracking-tight sm:text-4xl">{t("howTitle")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-white/60">{t("howSubtitle")}</p>

          <div className="relative mt-14 grid gap-10 sm:grid-cols-3">
            {/* connecting line */}
            <div className="absolute left-[16%] right-[16%] top-6 hidden h-px bg-gradient-to-r from-emerald-400/0 via-emerald-400/40 to-[#FDD835]/30 sm:block" />
            {steps.map((s) => (
              <div key={s.step} className="relative text-center">
                <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 text-xl font-black text-white shadow-[0_0_26px_-8px_rgba(16,185,129,0.9)] ring-4 ring-[#060a07]">
                  {s.step}
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">{s.title}</h3>
                <p className="mx-auto max-w-xs text-sm text-white/60">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Subjects marquee ── */}
      <section id="subjects" className="relative z-10 overflow-hidden py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-10 text-center text-2xl font-black tracking-tight sm:text-3xl">
            {t("subjectsTitle")}
          </h2>
        </div>
        <div
          className="relative flex overflow-hidden"
          style={{
            maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
            WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
          }}
        >
          <div className="lp-marquee flex w-max shrink-0 items-center gap-4 pr-4">
            {[...subjects, ...subjects].map((s, i) => (
              <span
                key={i}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white/85"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 px-4 py-20">
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/20 via-emerald-600/[0.08] to-[#FDD835]/10 p-10 text-center sm:p-16">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-emerald-400/20 blur-[100px]" />
          <div className="relative">
            <h2 className="text-3xl font-black tracking-tight sm:text-5xl">{t("ctaTitle")}</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/70">{t("ctaSubtitle")}</p>
            <Link
              href="/register"
              className="group mt-9 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-bold text-[#0a3d1a] shadow-[0_0_40px_-8px_rgba(255,255,255,0.5)] transition hover:bg-white/90"
            >
              {t("ctaButton")}
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <p className="mt-4 text-sm text-white/50">{t("ctaMicro")}</p>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/10 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center">
          <Logo size="sm" onDark />
          <p className="max-w-md text-sm text-white/50">{t("footerTagline")}</p>
          <p className="text-xs text-white/35">{t("footerCopyright")}</p>
        </div>
      </footer>
    </div>
  );
}
