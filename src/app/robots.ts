import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// The public URL comes from .env, which the Docker build doesn't have.
export const dynamic = "force-dynamic";

/**
 * Crawlers get the public pages only. Dashboards redirect a signed-out visitor
 * to /login anyway, so crawling them just wastes crawl budget; the one-off
 * auth steps (email links, callbacks) are noindex as well.
 */
export default function robots(): MetadataRoute.Robots {
  const url = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/student",
          "/teacher",
          "/secondary-teacher",
          "/school-admin",
          "/admin", // prefix: also covers the super-admin sign-in, which must not be named here
          "/grapher",
          "/offline",
          "/redirect",
          "/telegram-callback",
          "/verify-email",
          "/reset-password",
          "/change-password",
          "/complete-profile",
        ],
      },
    ],
    sitemap: `${url}/sitemap.xml`,
  };
}
