import type { Metadata } from "next";
import { TopicPageView, topicMetadata } from "@/components/seo/topic-page";

// Public topic page for search; content lives in lib/seo-pages.
export const metadata: Metadata = topicMetadata("quiz");

export default function QuizPage() {
  return <TopicPageView slug="quiz" />;
}
