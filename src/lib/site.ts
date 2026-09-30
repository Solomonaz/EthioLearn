import type { Metadata } from "next";

/**
 * Public identity of the site, for search engines and link previews.
 *
 * SITE_URL follows NEXTAUTH_URL (the public URL the deployment already sets),
 * so moving to abugida.et means changing .env only — canonical links, the
 * sitemap and structured data all follow. Read at request time: the Docker
 * build has no .env, so anything that uses it must render dynamically.
 */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "https://abugida.aderasend.com";
  return url.replace(/\/$/, "");
}

export const SITE_NAME = "Abugida";

export const SITE_TITLE = "Abugida – Textbook Quizzes & AI Tutor for Ethiopian Students, Grades 1–12";

export const SITE_DESCRIPTION =
  "Practise with quizzes made from Ethiopian national curriculum textbooks, get step-by-step help from an AI tutor, " +
  "and track progress. For students, teachers and schools, Grades 1–12, in English and Amharic.";

export const SITE_KEYWORDS = [
  "Abugida",
  "Ethiopian students",
  "Ethiopian curriculum",
  "Ethiopian national curriculum",
  "Ethiopian textbooks",
  "Ethiopia education",
  "online learning Ethiopia",
  "grade 12 Ethiopia",
  "grade 9-12 practice questions",
  "chapter quizzes",
  "AI tutor",
  "mathematics",
  "physics",
  "chemistry",
  "biology",
  "Amharic",
  "school management Ethiopia",
  "teacher tools",
];

/** Link-preview image (app/og-image.png/route.tsx), relative to metadataBase. */
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Abugida – textbook quizzes and an AI tutor for Ethiopian students, Grades 1–12",
};

/**
 * Metadata for one public, indexable page: its own canonical URL and a full
 * Open Graph / Twitter card (Next replaces those objects rather than merging
 * them with the root layout's, so each page spells them out).
 */
export function pageMetadata({ title, description, path }: { title?: string; description: string; path: string }): Metadata {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_TITLE;
  return {
    ...(title ? { title } : { title: { absolute: SITE_TITLE } }),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      url: path,
      locale: "en_US",
      alternateLocale: ["am_ET"],
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [OG_IMAGE.url] },
  };
}

/** For pages that must stay out of search results (they may still be crawled for links). */
export const NO_INDEX: Metadata = { robots: { index: false, follow: true } };
