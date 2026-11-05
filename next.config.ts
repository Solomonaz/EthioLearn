import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDev = process.env.NODE_ENV === "development";

// Content-Security-Policy
// Notes:
//  - 'unsafe-inline' for script-src is required by Next.js runtime hydration.
//  - 'unsafe-eval' is required by some Next.js internals in dev; omitted in prod.
//  - Tighten script-src further once nonce-based CSP is wired into the app shell.
const cspDirectives = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org https://oauth2.googleapis.com https://www.googletagmanager.com https://connect.facebook.net"
    : "script-src 'self' 'unsafe-inline' https://telegram.org https://oauth2.googleapis.com https://www.googletagmanager.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://t.me https://*.t.me https://telegram.org https://*.supabase.co https://lh3.googleusercontent.com https://graph.facebook.com https://*.google-analytics.com https://www.googletagmanager.com https://www.facebook.com",
  "font-src 'self'",
  "connect-src 'self' wss: ws: https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://connect.facebook.net",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: cspDirectives },
  // Only add HSTS in production (HTTPS required)
  ...(!isDev
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Strict Mode causes Server Components to double-render in dev, which
  // triggers repeated DB calls in layouts that call getCurrentUser().
  // Enable only when explicitly debugging side-effect purity.
  reactStrictMode: false,
  // pdf.js loads its worker (pdf.worker.mjs) from beside its own module file.
  // Bundled, it looked for the worker inside .next/dev/server/chunks, where it
  // does not exist — so layout-aware textbook extraction failed and every
  // upload fell back to flat text. Loaded from node_modules, it finds it.
  // tesseract.js spawns its OCR worker from a path relative to its own
  // package; bundled, that resolved to a bogus "C:/ROOT/node_modules/..." path
  // and the worker crashed the process with an uncaught error mid-extraction.
  serverExternalPackages: ["pdfjs-dist", "tesseract.js"],
  images: {
    remotePatterns: [
      // Telegram user profile photos
      { protocol: "https", hostname: "t.me" },
      { protocol: "https", hostname: "**.t.me" },
      { protocol: "https", hostname: "telegram.org" },
      { protocol: "https", hostname: "**.telegram.org" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
