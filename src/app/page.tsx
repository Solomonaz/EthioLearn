import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces } from "next/font/google";
import { getTranslations } from "next-intl/server";
import {
  Apple,
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  ClipboardList,
  CreditCard,
  Gamepad2,
  Gift,
  Library,
  LineChart,
  MessageSquare,
  Play,
  Sparkles,
  Swords,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { HeroPreview } from "@/components/home/hero-preview";
import { AppPreview } from "@/components/home/app-preview";
import { LandingNav } from "@/components/home/landing-nav";
import { QuizSimulation } from "@/components/home/quiz-simulation";
import { SITE_DESCRIPTION, SITE_NAME, pageMetadata, siteUrl } from "@/lib/site";
import { TOPIC_PAGES } from "@/lib/seo-pages";
import { TopicLinks } from "@/components/seo/topic-page";

// Display face for headings only; body text stays on the app's sans stack.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = pageMetadata({ description: SITE_DESCRIPTION, path: "/" });

const FAQ_COUNT = 7;

type Feature = { icon: LucideIcon; title: string; desc: string };
type Audience = { id: string; label: string; lead: string; features: Feature[] };

export default async function HomePage() {
  const t = await getTranslations("home");
  const tc = await getTranslations("common");

  const audiences: Audience[] = [
    {
      id: "students",
      label: t("studentsLabel"),
      lead: t("studentsLead"),
      features: [
        { icon: BookOpen, title: t("s1Title"), desc: t("s1Desc") },
        { icon: MessageSquare, title: t("s2Title"), desc: t("s2Desc") },
        { icon: Swords, title: t("s3Title"), desc: t("s3Desc") },
        { icon: LineChart, title: t("s4Title"), desc: t("s4Desc") },
        { icon: Trophy, title: t("s5Title"), desc: t("s5Desc") },
      ],
    },
    {
      id: "teachers",
      label: t("teachersLabel"),
      lead: t("teachersLead"),
      features: [
        { icon: Gamepad2, title: t("t1Title"), desc: t("t1Desc") },
        { icon: ClipboardList, title: t("t2Title"), desc: t("t2Desc") },
        { icon: TrendingUp, title: t("t3Title"), desc: t("t3Desc") },
        { icon: Sparkles, title: t("t4Title"), desc: t("t4Desc") },
        { icon: Boxes, title: t("t5Title"), desc: t("t5Desc") },
      ],
    },
    {
      id: "schools",
      label: t("schoolsLabel"),
      lead: t("schoolsLead"),
      features: [
        { icon: Users, title: t("c1Title"), desc: t("c1Desc") },
        { icon: Library, title: t("c2Title"), desc: t("c2Desc") },
        { icon: BarChart3, title: t("c3Title"), desc: t("c3Desc") },
        { icon: Gift, title: t("c4Title"), desc: t("c4Desc") },
        { icon: CreditCard, title: t("c5Title"), desc: t("c5Desc") },
      ],
    },
  ];

  const subjects = [
    t("mathematics"), t("physics"), t("chemistry"), t("biology"),
    t("english"), t("amharic"), t("history"), t("geography"),
  ];

  const faqs = Array.from({ length: FAQ_COUNT }, (_, i) => ({
    q: t(`faq${i + 1}Q`),
    a: t(`faq${i + 1}A`),
  }));

  // Structured data for search engines: who we are, the site, the app, and
  // the FAQ exactly as it appears on the page.
  const url = siteUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${url}/#organization`,
        name: SITE_NAME,
        url,
        logo: `${url}/icons/icon-512.png`,
        description: t("footerTagline"),
        areaServed: { "@type": "Country", name: "Ethiopia" },
      },
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        name: SITE_NAME,
        url,
        inLanguage: ["en", "am"],
        publisher: { "@id": `${url}/#organization` },
      },
      {
        "@type": "WebApplication",
        name: SITE_NAME,
        url,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Any (web browser)",
        description: SITE_DESCRIPTION,
        inLanguage: ["en", "am"],
        audience: { "@type": "EducationalAudience", educationalRole: ["student", "teacher"] },
        educationalLevel: "Grades 1–12",
        about: subjects,
        publisher: { "@id": `${url}/#organization` },
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <div className={`lp ${display.variable} min-h-screen`}>
      <script
        type="application/ld+json"
        // "<" escaped so text can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <LandingNav
        links={[
          ...audiences.map((a) => ({ href: `#${a.id}`, label: a.label })),
          { href: "#subjects", label: t("navSubjects") },
          { href: "#app", label: t("navApp") },
        ]}
        signIn={tc("signIn")}
        getStarted={tc("getStarted")}
        appName={tc("appName")}
        menuLabel={t("navMenu")}
      />

      <main>
      {/* ── Hero ── */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div>
          <p className="lp-rise text-xs font-semibold uppercase tracking-[0.14em] text-[var(--lp-green-ink)]">
            {t("eyebrow")}
          </p>
          <h1 className="lp-display lp-rise lp-rise-2 mt-5 text-[2.6rem] font-semibold leading-[1.04] sm:text-6xl">
            {t("heroTitle")} <span className="lp-mark">{t("heroTitleMark")}</span>
          </h1>
          <p className="lp-rise lp-rise-3 mt-6 max-w-xl text-lg leading-relaxed text-[var(--lp-muted)]">
            {t("heroDesc")}
          </p>
          <div className="lp-rise lp-rise-3 mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--lp-green)] px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-[#0d3b12]"
            >
              {tc("getStarted")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-full border border-[var(--lp-rule)] bg-[var(--lp-surface)] px-7 py-3.5 text-base font-semibold transition-colors hover:border-[var(--lp-faint)]"
            >
              {tc("signIn")}
            </Link>
          </div>
          <p className="mt-6 text-sm text-[var(--lp-faint)]">{t("heroNote")}</p>
        </div>

        <div className="flex justify-center lg:justify-end">
          <HeroPreview />
        </div>
      </section>

      {/* ── How a quiz is made (animated) ── */}
      <section id="how" className="scroll-mt-20 border-t border-[var(--lp-rule)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--lp-green-ink)]">
              {t("simEyebrow")}
            </p>
            <h2 className="lp-display mt-3 text-3xl font-semibold sm:text-4xl">{t("simTitle")}</h2>
            <p className="mt-3 text-[var(--lp-muted)]">{t("simDesc")}</p>
          </div>
          <div className="mt-12">
            <QuizSimulation
              steps={[1, 2, 3, 4].map((n) => ({
                title: t(`simStep${n}Title`),
                desc: t(`simStep${n}Desc`),
              }))}
              caption={t("simCaption")}
            />
          </div>
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section className="border-t border-[var(--lp-rule)] bg-[var(--lp-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="lp-display text-3xl font-semibold sm:text-4xl">{t("audienceTitle")}</h2>
            <p className="mt-3 text-[var(--lp-muted)]">{t("audienceSubtitle")}</p>
          </div>

          <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-0 md:divide-x md:divide-[var(--lp-rule)]">
            {audiences.map((a, i) => (
              <div key={a.id} id={a.id} className="scroll-mt-24 md:px-8 md:first:pl-0 md:last:pr-0">
                <div className="flex items-baseline gap-3 border-b border-[var(--lp-rule)] pb-4">
                  <span className="lp-display text-sm font-semibold text-[var(--lp-faint)]">
                    0{i + 1}
                  </span>
                  <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--lp-green-ink)]">
                    {a.label}
                  </h3>
                </div>
                <p className="lp-display mt-5 text-2xl font-medium leading-snug">{a.lead}</p>
                <ul className="mt-7 space-y-5">
                  {a.features.map((f) => (
                    <li key={f.title} className="flex gap-3.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--lp-green-soft)] text-[var(--lp-green-ink)]">
                        <f.icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div>
                        <p className="text-[15px] font-semibold">{f.title}</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-[var(--lp-muted)]">{f.desc}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Curriculum ── */}
      <section id="subjects" className="scroll-mt-20 border-t border-[var(--lp-rule)]">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 md:grid-cols-[auto_1fr] md:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--lp-faint)]">
              {t("gradesLabel")}
            </p>
            <p className="lp-display mt-1 text-7xl font-semibold leading-none text-[var(--lp-green-ink)] sm:text-8xl">
              1–12
            </p>
          </div>
          <div>
            <h2 className="lp-display text-3xl font-semibold sm:text-4xl">{t("subjectsTitle")}</h2>
            <p className="mt-3 max-w-xl text-[var(--lp-muted)]">{t("subjectsDesc")}</p>
            <ul className="mt-7 flex flex-wrap gap-2">
              {subjects.map((s) => (
                <li
                  key={s}
                  className="rounded-full border border-[var(--lp-rule)] bg-[var(--lp-surface)] px-4 py-1.5 text-sm font-medium"
                >
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Explore: links to the topic pages (what people search for) ── */}
      <section id="explore" className="scroll-mt-20 border-t border-[var(--lp-rule)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="lp-display text-3xl font-semibold sm:text-4xl">Explore Abugida</h2>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOPIC_PAGES.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/${p.slug}`}
                  className="group flex h-full flex-col rounded-2xl border border-[var(--lp-rule)] bg-[var(--lp-surface)] p-6 transition-colors hover:border-[var(--lp-faint)]"
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--lp-green-ink)]">{p.eyebrow}</span>
                  <span className="mt-3 text-lg font-semibold">{p.navLabel}</span>
                  <span className="mt-2 text-sm leading-relaxed text-[var(--lp-muted)]">{p.summary}</span>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--lp-green-ink)]">
                    Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Mobile app: Android APK download; iOS coming soon ── */}
      <section id="app" className="scroll-mt-20 border-t border-[var(--lp-rule)] bg-[var(--lp-surface)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:px-6 md:grid-cols-[1fr_auto] md:gap-20">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--lp-rule)] px-3 py-1 text-xs font-semibold text-[var(--lp-green-ink)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--lp-yellow)]" />
              {t("appEyebrow")}
            </span>
            <h2 className="lp-display mt-5 text-3xl font-semibold sm:text-5xl">{t("appTitle")}</h2>
            <p className="mt-4 text-lg leading-relaxed text-[var(--lp-muted)]">{t("appDesc")}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="/downloads/abugida.apk"
                download="Abugida.apk"
                className="flex items-center gap-3 rounded-xl bg-[var(--lp-green)] px-4 py-2.5 text-white transition-colors hover:bg-[#0d3b12]"
              >
                <Play className="h-6 w-6" aria-hidden />
                <div className="leading-tight">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/75">{t("appApkMeta")}</p>
                  <p className="text-sm font-semibold">{t("appAndroid")}</p>
                </div>
              </a>
              <div
                aria-disabled="true"
                className="flex cursor-default items-center gap-3 rounded-xl border border-dashed border-[var(--lp-faint)] px-4 py-2.5 text-[var(--lp-muted)]"
              >
                <Apple className="h-6 w-6" aria-hidden />
                <div className="leading-tight">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em]">{t("appSoon")}</p>
                  <p className="text-sm font-semibold text-[var(--lp-ink)]">{t("appStore")}</p>
                </div>
              </div>
            </div>

            <p className="mt-6 text-sm text-[var(--lp-faint)]">{t("appNote")}</p>
          </div>

          <AppPreview />
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="scroll-mt-20 border-t border-[var(--lp-rule)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-[1fr_2fr] md:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--lp-green-ink)]">
              {t("faqEyebrow")}
            </p>
            <h2 className="lp-display mt-3 text-3xl font-semibold sm:text-4xl">{t("faqTitle")}</h2>
          </div>
          <div className="divide-y divide-[var(--lp-rule)] border-y border-[var(--lp-rule)]">
            {faqs.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                  <h3>{f.q}</h3>
                  <span
                    aria-hidden
                    className="mt-0.5 text-xl leading-none text-[var(--lp-faint)] transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-2xl leading-relaxed text-[var(--lp-muted)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Call to action ── */}
      <section className="px-4 py-20 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 rounded-3xl bg-[var(--lp-band)] px-8 py-12 text-[var(--lp-band-ink)] sm:px-12 md:flex-row md:items-center">
          <div className="max-w-xl">
            <h2 className="lp-display text-3xl font-semibold sm:text-4xl">{t("ctaTitle")}</h2>
            <p className="mt-3 text-[var(--lp-band-ink)]/75">{t("ctaSubtitle")}</p>
          </div>
          <Link
            href="/register"
            className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--lp-yellow)] px-7 py-3.5 text-base font-semibold text-[#13201a] transition-colors hover:bg-[#f9c80e]"
          >
            {t("ctaButton")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--lp-rule)]">
        <div className="mx-auto max-w-6xl px-4 pt-8 text-sm text-[var(--lp-faint)] sm:px-6">
          <TopicLinks />
        </div>
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-[var(--lp-faint)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <span className="dark:hidden"><Logo size="sm" /></span>
            <span className="hidden dark:block"><Logo size="sm" onDark /></span>
            <span className="hidden sm:inline">·</span>
            <span>{t("footerTagline")}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-[var(--lp-ink)]">Privacy</Link>
            <Link href="/terms" className="hover:text-[var(--lp-ink)]">Terms</Link>
            <p>{t("footerCopyright")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
