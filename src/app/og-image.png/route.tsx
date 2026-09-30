import { ImageResponse } from "next/og";
import { OG_IMAGE } from "@/lib/site";

/**
 * The preview card shown when an Abugida link is shared (Telegram, Facebook,
 * WhatsApp, X, LinkedIn) and in some search features. Referenced from every
 * public page's metadata (OG_IMAGE in lib/site). A plain route rather than the
 * opengraph-image convention, which pages with their own openGraph lose.
 */
export const dynamic = "force-static";

// The brand symbol (public/brand/logo-symbol-white.svg), inlined so the
// image needs no file or network access to render.
const SYMBOL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="330 210 596 596"><line x1="412" y1="628" x2="628" y2="330" stroke="#FFFFFF" stroke-width="60" stroke-linecap="round"/><line x1="628" y1="330" x2="844" y2="628" stroke="#FFFFFF" stroke-width="60" stroke-linecap="round"/><g stroke="#10321a" stroke-width="16" stroke-linejoin="round"><path d="M 620 612 C 560 574 494 562 452 571 L 402 662 C 470 650 556 658 620 708 Z" fill="#FFFFFF"/><path d="M 636 612 C 696 574 762 562 804 571 L 854 662 C 786 650 700 658 636 708 Z" fill="#FFFFFF"/></g><circle cx="628" cy="522" r="48" fill="#FFFFFF" stroke="#10321a" stroke-width="10"/></svg>`;

export function GET() {
  const subjects = ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Amharic"];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#10321a",
          color: "#f4f1e8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/svg+xml;base64,${Buffer.from(SYMBOL).toString("base64")}`}
            width={76}
            height={76}
            alt=""
          />
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: -1 }}>Abugida</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 28, color: "#fdd835", fontWeight: 600, letterSpacing: 2 }}>
            FOR ETHIOPIAN SCHOOLS · GRADES 1–12
          </div>
          <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.1, marginTop: 18, maxWidth: 1060 }}>
            Practise with your own textbook. Learn with an AI tutor.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {subjects.map((s) => (
            <div
              key={s}
              style={{
                display: "flex",
                padding: "8px 20px",
                borderRadius: 999,
                border: "2px solid rgba(244,241,232,0.35)",
                fontSize: 24,
              }}
            >
              {s}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: OG_IMAGE.width,
      height: OG_IMAGE.height,
      headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
    }
  );
}
