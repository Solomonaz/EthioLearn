"use client";

/**
 * Last resort: the root layout itself failed, so there are no styles, no
 * translations and no providers — plain inline styles, English and Amharic
 * together, a reload that really reloads, and the error code (Next's digest)
 * the team can find in the server logs.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const btn = {
    padding: "0.7rem 1.4rem",
    borderRadius: "0.6rem",
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.95rem",
  } as const;
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#F9FAFB", color: "#111827" }}>
        <div
          role="alert"
          style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: "1rem", textAlign: "center", padding: "1.5rem" }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Something went wrong on our side</h1>
          <p style={{ color: "#4B5563", margin: 0, maxWidth: "28rem" }}>
            Abugida couldn&apos;t load. It&apos;s not something you did — please try again in a moment.
          </p>
          <p style={{ color: "#4B5563", margin: 0, maxWidth: "28rem" }}>አቡጊዳ መጫን አልቻለም። የእርስዎ ስህተት አይደለም — እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።</p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => window.location.reload()} style={{ ...btn, background: "#1B5E20", color: "white" }}>
              Try again · እንደገና ሞክር
            </button>
            <a href="/" style={{ ...btn, background: "white", color: "#374151", border: "1px solid #E5E7EB", textDecoration: "none" }}>
              Home · መነሻ
            </a>
          </div>
          {error.digest && (
            <p style={{ color: "#9CA3AF", fontSize: "0.75rem", margin: 0 }}>
              Error code: <span style={{ fontFamily: "monospace" }}>{error.digest}</span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
