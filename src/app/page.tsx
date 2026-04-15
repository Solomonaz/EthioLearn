import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BookOpen, Trophy, Swords, Target, Zap, Star } from "lucide-react";
import { LanguageSwitcher } from "@/components/ui/language-switcher";

export default async function HomePage() {
  const t = await getTranslations("home");
  const tc = await getTranslations("common");
  const ta = await getTranslations("auth");

  const features = [
    { icon: BookOpen, title: t("feature1Title"), desc: t("feature1Desc") },
    { icon: Swords,   title: t("feature2Title"), desc: t("feature2Desc") },
    { icon: Trophy,   title: t("feature3Title"), desc: t("feature3Desc") },
    { icon: Target,   title: t("feature4Title"), desc: t("feature4Desc") },
    { icon: Zap,      title: t("feature5Title"), desc: t("feature5Desc") },
    { icon: Star,     title: t("feature6Title"), desc: t("feature6Desc") },
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

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-2xl font-black text-primary">{tc("appName")}</span>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link href="/login" className="text-sm font-medium text-text-secondary hover:text-primary">
              {tc("signIn")}
            </Link>
            <Link href="/register" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">
              {tc("getStarted")}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-24">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
          <Star className="h-4 w-4" />
          {t("tagline")}
        </div>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-text-primary sm:text-6xl">
          {t("heroTitle")}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
          {t("heroDesc")}
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link href="/register" className="w-full rounded-xl bg-primary px-8 py-4 text-lg font-bold text-white hover:bg-primary/90 sm:w-auto">
            {t("startFree")}
          </Link>
          <Link href="/login" className="w-full rounded-xl border border-border px-8 py-4 text-lg font-semibold text-text-primary hover:bg-gray-50 sm:w-auto">
            {tc("signIn")}
          </Link>
        </div>
        {/* Stats row */}
        <div className="mt-16 grid grid-cols-3 gap-8 border-t border-border pt-12">
          {[
            { label: t("statsQuestions"), value: "10,000+" },
            { label: t("statsSubjects"),  value: "10+" },
            { label: t("statsGrades"),    value: "7-12" },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-3xl font-black text-primary">{s.value}</div>
              <div className="mt-1 text-sm text-text-secondary">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section className="bg-surface py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-2 text-center text-3xl font-bold text-text-primary">{t("featuresTitle")}</h2>
          <p className="mb-12 text-center text-text-secondary">{t("featuresSubtitle")}</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-background p-6">
                <div className="mb-4 w-fit rounded-lg bg-primary/10 p-3">
                  <f.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 font-bold text-text-primary">{f.title}</h3>
                <p className="text-sm text-text-secondary">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-12 text-center text-3xl font-bold text-text-primary">{t("howTitle")}</h2>
        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.step} className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-black text-white">
                {s.step}
              </div>
              <h3 className="mb-2 font-bold text-text-primary">{s.title}</h3>
              <p className="text-sm text-text-secondary">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Subjects */}
      <section className="bg-surface py-12">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-8 text-center text-2xl font-bold text-text-primary">{t("subjectsTitle")}</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {subjects.map((s) => (
              <span key={s} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-text-primary">
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <div className="rounded-2xl bg-primary px-8 py-12">
          <h2 className="text-3xl font-black text-white">{t("ctaTitle")}</h2>
          <p className="mt-3 text-white/80">{t("ctaSubtitle")}</p>
          <Link href="/register" className="mt-8 inline-block rounded-xl bg-white px-8 py-4 text-lg font-bold text-primary hover:bg-white/90">
            {t("ctaButton")}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-surface py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-text-muted">
          <p className="font-bold text-primary">{tc("appName")}</p>
          <p className="mt-1">{t("footerCopyright")}</p>
        </div>
      </footer>
    </div>
  );
}
