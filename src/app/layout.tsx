import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { PWAInit } from "@/components/pwa-init";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "EthioLearn",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
          <PWAInit />
          <ThemeProvider>
            <AuthProvider>{children}</AuthProvider>
          </ThemeProvider>
          <Toaster />
        </body>
    </html>
  );
}
