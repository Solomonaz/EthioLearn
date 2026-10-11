import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { TOPIC_PAGES } from "@/lib/seo-pages";

// The public URL comes from .env, which the Docker build doesn't have.
export const dynamic = "force-dynamic";

/** Every public, indexable page. Add new marketing/legal pages here. */
export default function sitemap(): MetadataRoute.Sitemap {
  const url = siteUrl();
  return [
    { url: `${url}/`, changeFrequency: "weekly", priority: 1 },
    ...TOPIC_PAGES.map((p) => ({ url: `${url}/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.9 })),
    { url: `${url}/register`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${url}/login`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${url}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${url}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
