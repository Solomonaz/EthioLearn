import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDev = process.env.NODE_ENV === "development";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
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
