"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html>
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: "1rem", textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold" }}>Critical Error</h1>
          <p style={{ color: "#6b7280" }}>The application encountered a critical error.</p>
          <button onClick={reset} style={{ background: "#1B5E20", color: "white", padding: "0.75rem 1.5rem", borderRadius: "0.5rem", border: "none", cursor: "pointer" }}>
            Reload App
          </button>
        </div>
      </body>
    </html>
  );
}
