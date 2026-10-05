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

export const SITE_TITLE =
  "Abugida – Ethiopian Education Online: Quizzes, National Exam Practice, AI Tutor & Battle Quiz, Grades 1–12";

export const SITE_DESCRIPTION =
  "Learn with the Ethiopian national curriculum: chapter quizzes from your textbooks, past Grade 12 national exam " +
  "(ESSLCE / EUEE) papers, an AI tutor, adaptive practice and live battle quizzes. For students, teachers and schools, " +
  "Grades 1–12, in English and Amharic.";

/**
 * Site-wide keywords (each topic page adds its own, see lib/seo-pages). Google
 * ignores the keywords tag; Bing and smaller engines still read it. Ranking
 * comes from the words on the pages themselves, which is why the topic pages exist.
 */
export const SITE_KEYWORDS = [
  // Brand
  "Abugida", "Abugida education", "Abugida learning", "Abugida app", "አቡጊዳ",
  // Ethiopian education
  "Ethiopia education", "Ethiopian education", "education in Ethiopia", "Ethiopian education system",
  "Ethiopian curriculum", "new Ethiopian curriculum", "Ethiopian national curriculum", "Ethiopian textbooks",
  "Ethiopian student textbook", "Ministry of Education Ethiopia", "Ethiopian students", "Ethiopian schools",
  "online learning Ethiopia", "e-learning Ethiopia", "edtech Ethiopia", "education app Ethiopia",
  "learning platform Ethiopia", "Ethiopian high school", "Ethiopian secondary school", "Ethiopian primary school",
  // National exam
  "Ethiopian national exam", "Grade 12 national exam", "national exam practice", "ESSLCE", "EUEE",
  "Ethiopian university entrance exam", "entrance exam Ethiopia", "national exam past papers",
  "national exam questions and answers", "Grade 8 national exam", "matric Ethiopia", "model exam Ethiopia",
  // Quizzes and questions
  "quiz", "online quiz", "practice questions", "chapter quizzes", "questions and answers", "multiple choice questions",
  "practice test", "mock exam", "exam preparation Ethiopia", "Grade 9 questions", "Grade 10 questions",
  "Grade 11 questions", "Grade 12 questions", "Grade 7 questions", "Grade 8 questions",
  // Battle quiz and games
  "battle quiz", "quiz battle", "live quiz battle", "quiz game", "multiplayer quiz", "quiz competition",
  "educational games", "classroom games", "gamified learning", "leaderboard", "daily challenge",
  // AI and adaptive learning
  "AI tutor", "AI education", "AI in education", "AI learning", "AI homework help", "AI study assistant",
  "adaptive learning", "personalized learning", "adaptive quiz", "learning analytics", "student progress tracking",
  // Subjects
  "mathematics", "physics", "chemistry", "biology", "English", "Amharic", "history", "geography",
  "information technology", "IT textbook Grade 9", "IT textbook Grade 12",
  // Teachers and schools
  "teacher tools", "AI teaching assistant", "homework app", "school management Ethiopia", "Grades 1–12",
  // Amharic
  "ትምህርት", "የኢትዮጵያ ትምህርት", "ሥርዓተ ትምህርት", "መማሪያ መጽሐፍ", "ብሔራዊ ፈተና", "የ12ኛ ክፍል ብሔራዊ ፈተና",
  "የመግቢያ ፈተና", "ጥያቄዎች", "ጥያቄና መልስ", "ፈተና", "ሞዴል ፈተና", "የጥያቄ ውድድር", "የAI አስተማሪ", "ተማሪ", "መምህር",
];

/** Link-preview image (app/og-image.png/route.tsx), relative to metadataBase. */
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Abugida – quizzes, national exam practice and an AI tutor for Ethiopian students, Grades 1–12",
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
