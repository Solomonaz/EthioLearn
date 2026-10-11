import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces } from "next/font/google";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LandingNav } from "@/components/home/landing-nav";
import { SITE_NAME, SITE_KEYWORDS, pageMetadata, siteUrl } from "@/lib/site";
import { TOPIC_PAGES, topicPage, type TopicPage } from "@/lib/seo-pages";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });

/** Metadata for a topic page: its own title, description, canonical URL and keywords. */
export function topicMetadata(slug: string): Metadata {
  const p = topicPage(slug);
  return {
    ...pageMetadata({ title: p.title, description: p.description, path: `/${p.slug}` }),
    keywords: [...p.keywords, ...SITE_KEYWORDS.slice(0, 12)],
  };
}

/** Links to every topic page — for the homepage and page footers (internal links help search engines find them). */
export function TopicLinks({ exclude, className }: { exclude?: string; className?: string }) {
  return (
    <ul className={className ?? "flex flex-wrap gap-x-5 gap-y-2"}>
      {TOPIC_PAGES.filter((p) => p.slug !== exclude).map((p) => (
        <li key={p.slug}>
          <Link href={`/${p.slug}`} className="hover:text-[var(--lp-ink)] hover:underline">
            {p.navLabel}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * One public topic page (see lib/seo-pages): the landing page's look, a plain
 * article that explains the feature, an Amharic summary, FAQs, and structured
 * data (WebPage + BreadcrumbList + FAQPage) matching exactly what is shown.
 */
export async function TopicPageView({ slug }: { slug: string }) {
  const p: TopicPage = topicPage(slug);
  const t = await getTranslations("home");
  const tc = await getTranslations("common");
  const url = siteUrl();
  const pageUrl = `${url}/${p.slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": p.schemaType,
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: p.title,
        description: p.description,
        inLanguage: ["en", "am"],
        keywords: p.keywords.join(", "),
        isPartOf: { "@id": `${url}/#website` },
        about: { "@type": "Thing", name: p.navLabel },
        audience: { "@type": "EducationalAudience", educationalRole: ["student", "teacher"] },
        publisher: { "@type": "Organization", name: SITE_NAME, url },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${url}/` },
          { "@type": "ListItem", position: 2, name: p.navLabel, item: pageUrl },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: p.faqs.map((f) => ({
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
        links={TOPIC_PAGES.filter((x) => x.slug !== p.slug)
          .slice(0, 4)
          .map((x) => ({ href: `/${x.slug}`, label: x.navLabel }))}
        signIn={tc("signIn")}
        getStarted={tc("getStarted")}
        appName={tc("appName")}
        menuLabel={t("navMenu")}
      />

      <main>
        <article>
          <header className="mx-auto max-w-3xl px-4 pb-10 pt-14 sm:px-6 sm:pt-20">
            <nav aria-label="Breadcrumb" className="text-sm text-[var(--lp-faint)]">
              <Link href="/" className="hover:text-[var(--lp-ink)]">
                {SITE_NAME}
              </Link>{" "}
              / <span>{p.navLabel}</span>
            </nav>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--lp-green-ink)]">
              {p.eyebrow}
            </p>
            <h1 className="lp-display mt-4 text-[2.3rem] font-semibold leading-[1.08] sm:text-5xl">{p.h1}</h1>
            <p className="mt-6 text-lg leading-relaxed text-[var(--lp-muted)]">{p.intro}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
          </header>

          <div className="border-t border-[var(--lp-rule)]">
            <div className="mx-auto max-w-3xl space-y-12 px-4 py-14 sm:px-6">
              {p.sections.map((s) => (
                <section key={s.heading}>
                  <h2 className="lp-display text-2xl font-semibold sm:text-3xl">{s.heading}</h2>
                  {s.paragraphs?.map((para) => (
                    <p key={para.slice(0, 40)} className="mt-4 leading-relaxed text-[var(--lp-muted)]">
                      {para}
                    </p>
                  ))}
                  {s.bullets && (
                    <ul className="mt-4 space-y-2.5">
                      {s.bullets.map((b) => (
                        <li key={b} className="flex gap-3 leading-relaxed text-[var(--lp-muted)]">
                          <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--lp-green)]" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}

              <section lang="am" className="rounded-2xl border border-[var(--lp-rule)] bg-[var(--lp-surface)] p-6">
                <h2 className="text-xl font-semibold">{p.amharic.heading}</h2>
                <p className="mt-3 leading-relaxed text-[var(--lp-muted)]">{p.amharic.text}</p>
              </section>
            </div>
          </div>

          <section className="border-t border-[var(--lp-rule)] bg-[var(--lp-surface)]">
            <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
              <h2 className="lp-display text-2xl font-semibold sm:text-3xl">Questions people ask</h2>
              <div className="mt-6 divide-y divide-[var(--lp-rule)] border-y border-[var(--lp-rule)]">
                {p.faqs.map((f) => (
                  <details key={f.q} className="group py-5">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                      <h3>{f.q}</h3>
                      <span aria-hidden className="mt-0.5 text-xl leading-none text-[var(--lp-faint)] transition-transform group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <p className="mt-3 leading-relaxed text-[var(--lp-muted)]">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        </article>

        <section className="px-4 py-16 sm:px-6">
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

      <footer className="border-t border-[var(--lp-rule)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 text-sm text-[var(--lp-faint)] sm:px-6">
          <TopicLinks exclude={p.slug} />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
        </div>
      </footer>
    </div>
  );
}
