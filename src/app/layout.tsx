import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AuthProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { PWAInit } from "@/components/pwa-init";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Abugida",
  description: "Ethiopia's #1 gamified learning platform for students",
  manifest: "/manifest.json",
  keywords: [
    "Ethiopia",
    "education",
    "learning",
    "quiz",
    "gamified",
    "exam preparation",
  ],
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon-192.png",
  },
};

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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
