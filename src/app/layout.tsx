import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Analytics } from "@/components/analytics";
import { AuthProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { PWAInit } from "@/components/pwa-init";
import { Toaster } from "@/components/ui/sonner";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, siteUrl } from "@/lib/site";
import "./globals.css";

/**
 * Site-wide defaults for search engines and link previews. No canonical here —
 * every page would inherit it; public pages set their own via pageMetadata()
 * (lib/site), and signed-in surfaces opt out of indexing in their layouts. A function, not a constant, so the
 * public URL is read at request time (see lib/site).
 */
export function generateMetadata(): Metadata {
  const url = siteUrl();
  return {
    metadataBase: new URL(url),
    title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    keywords: SITE_KEYWORDS,
    category: "education",
    creator: SITE_NAME,
    publisher: SITE_NAME,
    manifest: "/manifest.json",
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      locale: "en_US",
      alternateLocale: ["am_ET"],
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [OG_IMAGE.url],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    // Search Console / Bing Webmaster ownership, set in .env when registering.
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
      other: process.env.BING_SITE_VERIFICATION
        ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
        : undefined,
    },
    formatDetection: { telephone: false, email: false, address: false },
    icons: {
      icon: [
        { url: "/icons/icon.svg", type: "image/svg+xml" },
        { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      ],
      apple: "/icons/apple-touch-icon.png",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1B5E20",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          <PWAInit />
          <ThemeProvider>
            <AuthProvider>{children}</AuthProvider>
          </ThemeProvider>
          <Toaster />
          <Analytics
            gaId={process.env.GA_MEASUREMENT_ID || undefined}
            pixelId={process.env.META_PIXEL_ID || undefined}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
