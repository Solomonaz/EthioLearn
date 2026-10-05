import type { Metadata } from "next";
import { TopicPageView, topicMetadata } from "@/components/seo/topic-page";

// Public topic page for search; content lives in lib/seo-pages.
export const metadata: Metadata = topicMetadata("battle-quiz");

export default function BattleQuizPage() {
  return <TopicPageView slug="battle-quiz" />;
}
