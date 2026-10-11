import type { Metadata } from "next";
import { TopicPageView, topicMetadata } from "@/components/seo/topic-page";

// Public topic page for search; content lives in lib/seo-pages.
export const metadata: Metadata = topicMetadata("ethiopian-education");

export default function EthiopianEducationPage() {
  return <TopicPageView slug="ethiopian-education" />;
}
