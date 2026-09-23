"use client";

import { useRef, useState } from "react";
import {
  Sparkles,
  ExternalLink,
  ArrowRight,
  Camera,
  MessageCircleQuestion,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useEntitlements } from "@/hooks/use-entitlements";
import { GraphPlotter } from "./graph-plotter";

/** Render text with numeric values (incl. negatives/decimals) tinted. */
function withNumbers(text: string) {
  return text.split(/(-?\d+(?:\.\d+)?)/g).map((part, i) =>
    /^-?\d/.test(part) ? (
      <span key={i} className="font-semibold text-info">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Read a File and return a resized JPEG data URL (keeps the upload small). */
function resizeImage(file: File, maxDim = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.fillStyle = "#fff"; // flatten transparency for JPEG
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Full grapher experience: an AI helper that turns plain language into
 * equations, plus the interactive plotter. Reused by the in-app page and the
 * pop-out window. When a `standalone` window it hides the "open window" button.
 */
export function GrapherApp({
  initial,
  standalone = false,
}: {
  initial?: string[];
  standalone?: boolean;
}) {
  // AI helpers here (natural-language graphing, graph-photo explanations) are
  // governed by the global "AI in Graphing & 3D Geometry" switch. Optimistic
  // while loading so the common (AI-on) case never flashes the bar away.
  const ent = useEntitlements();
  const aiTools = ent.aiFeatures.aiMathTools;

  const seedInitial = (initial ?? []).filter((s) => s.trim());
  const [seed, setSeed] = useState<string[]>(seedInitial.length ? seedInitial : ["x^2"]);
  const [nonce, setNonce] = useState(0); // remounts the plotter with a new seed
  const [ai, setAi] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [imgLoading, setImgLoading] = useState(false);
  const [explain, setExplain] = useState<{
    thumb: string;
    summary: string;
    features: { label: string; value: string }[];
    equations: string[];
  } | null>(null);
  const [qa, setQa] = useState<{ q: string; a: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const askFollowup = async () => {
    const q = question.trim();
    if (!q || asking || !explain) return;
    setAsking(true);
    try {
      const history = qa.flatMap((t) => [
        { role: "user", text: t.q },
        { role: "assistant", text: t.a },
      ]);
      const res = await fetch("/api/graph/explain/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: explain.thumb,
          mimeType: "image/jpeg",
          question: q,
          history,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Couldn't answer that.");
        return;
      }
      setQa((prev) => [...prev, { q, a: String(data.answer ?? "") }]);
      setQuestion("");
    } catch {
      toast.error("AI is unavailable right now.");
    } finally {
      setAsking(false);
    }
  };

  const applyEquations = (eqs: string[]) => {
    setSeed(eqs);
    setNonce((n) => n + 1);
    toast.success(`Graphing ${eqs.length} function${eqs.length > 1 ? "s" : ""}`);
  };

  // Upload a photo of a GRAPH → get a student-friendly explanation of it.
  const onImage = async (file: File | null | undefined) => {
    if (!file || imgLoading) return;
    setImgLoading(true);
    try {
      const dataUrl = await resizeImage(file);
      const res = await fetch("/api/graph/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, mimeType: "image/jpeg" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Couldn't explain that image.");
        return;
      }
      setExplain({
        thumb: dataUrl,
        summary: String(data.summary ?? ""),
        features: Array.isArray(data.features) ? data.features : [],
        equations: Array.isArray(data.equations) ? data.equations : [],
      });
      setQa([]);
      setQuestion("");
    } catch {
      toast.error("Couldn't read that image.");
    } finally {
      setImgLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const askAi = async () => {
    const prompt = ai.trim();
    if (!prompt || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/graph/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't understand that.");
        return;
      }
      const eqs: string[] = data.equations ?? [];
      if (eqs.length === 0) {
        toast.error("Couldn't turn that into a graph — try rephrasing.");
        return;
      }
      setSeed(eqs);
      setNonce((n) => n + 1);
      toast.success(`Graphing ${eqs.length} function${eqs.length > 1 ? "s" : ""}`);
    } catch {
      toast.error("AI is unavailable right now.");
    } finally {
      setAiLoading(false);
    }
  };

  const openWindow = () => {
    window.open(
      "/grapher",
      "ethiolearn-grapher",
      "width=1100,height=760,menubar=no,toolbar=no,location=no,status=no",
    );
  };

  return (
    <div className="space-y-4">
      {/* Compact command bar — type/describe to graph, or upload a graph to explain.
          The AI pieces are hidden when AI is off platform-wide; the bar only
          renders if it has something to show (an AI tool, or the pop-out button). */}
      {(aiTools || !standalone) && (
      <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-2.5 shadow-sm lg:flex-row lg:items-center">
        {/* Ask AI to graph it */}
        {aiTools && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <input
              value={ai}
              onChange={(e) => setAi(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askAi()}
              placeholder="Type or describe an equation — e.g. a parabola opening down, 1/x, ln(x)"
              maxLength={500}
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button
            onClick={askAi}
            disabled={aiLoading || !ai.trim()}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {aiLoading ? "Drawing…" : "Draw it"}
          </button>
        </div>
        )}

        {aiTools && <div className="hidden h-7 w-px shrink-0 bg-border lg:block" />}

        {/* Explain a graph + open in window */}
        <div className="flex items-center gap-2">
          {aiTools && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={imgLoading}
            title="Upload a photo of a graph to have it explained"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-semibold text-text-secondary transition hover:border-secondary-dark/50 hover:text-secondary-dark disabled:cursor-not-allowed disabled:opacity-50 lg:flex-none"
          >
            {imgLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            {imgLoading ? "Reading…" : "Explain a graph"}
          </button>
          )}
          {!standalone && (
            <button
              onClick={openWindow}
              title="Open the grapher in its own window"
              aria-label="Open in window"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold text-text-secondary transition hover:border-primary/40 hover:text-primary"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="hidden xl:inline"></span>
            </button>
          )}
        </div>
      </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onImage(e.target.files?.[0])}
      />

        {explain && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3 shadow-sm sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={explain.thumb}
              alt="Uploaded graph"
              className="h-28 w-full shrink-0 rounded-lg border border-border bg-background object-contain sm:w-44"
            />
            <div className="min-w-0 flex-1">
              {explain.summary && (
                <p className="text-sm leading-relaxed text-text-primary">
                  {withNumbers(explain.summary)}
                </p>
              )}
              {explain.features.length > 0 && (
                <ul className="mt-2.5 space-y-1.5">
                  {explain.features.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
                      <span className="text-text-secondary">
                        <span className="font-semibold text-text-primary">{f.label}: </span>
                        {withNumbers(f.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {explain.equations.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-text-muted">Plot it:</span>
                  {explain.equations.map((eq) => (
                    <button
                      key={eq}
                      onClick={() => applyEquations([eq])}
                      className="rounded-lg bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary ring-1 ring-primary/20 transition hover:bg-primary/20"
                    >
                      y = {eq}
                    </button>
                  ))}
                </div>
              )}
              {/* Follow-up Q&A about this graph */}
              <div className="mt-3 border-t border-border pt-2.5">
                {qa.length > 0 && (
                  <div className="mb-2 space-y-2">
                    {qa.map((t, i) => (
                      <div key={i} className="space-y-1">
                        <p className="flex items-start gap-1.5 text-xs font-semibold text-text-secondary">
                          <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          {t.q}
                        </p>
                        <p className="pl-5 text-sm leading-relaxed text-text-primary">
                          {withNumbers(t.a)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && askFollowup()}
                    placeholder="Ask about this graph — e.g. why does it have two roots?"
                    maxLength={300}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    onClick={askFollowup}
                    disabled={asking || !question.trim()}
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-bold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {asking ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                onClick={() => {
                  setExplain(null);
                  setQa([]);
                  setQuestion("");
                }}
                className="mt-2.5 text-xs text-text-muted underline transition hover:text-text-primary"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

      <GraphPlotter initial={seed} seedKey={nonce} aiTools={aiTools} />
    </div>
  );
}
