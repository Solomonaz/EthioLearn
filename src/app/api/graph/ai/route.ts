import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { usageActor } from "@/lib/usage-logger";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { chatWithTutor } from "@/lib/ai-provider";
import { parseEquations } from "@/lib/graph-parse";

/**
 * POST /api/graph/ai — turn a natural-language math request into plottable
 * expressions for the grapher. e.g. "the natural log of x and its reciprocal"
 * → ["ln(x)", "1/x"]. Uses the shared AI provider chain (Gemini → Groq → …),
 * gated by the platform AI switch. Always returns a clean string[] of
 * mathjs-compatible expressions in terms of x.
 */

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Every call here spends real tokens at a paid provider, so an unmetered
  // endpoint is a cost attack as much as an availability one. 20/min per
  // user is far above human pace for chat turns and still bounds the damage.
  const rl = rateLimit(`ai:graph:${user.id}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!(await isAiFeatureEnabled("aiMathTools"))) {
    return NextResponse.json({ error: "AI is turned off" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const prompt = String(body?.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Describe what to graph" }, { status: 400 });
  if (prompt.length > 500) {
    return NextResponse.json({ error: "Please keep it short" }, { status: 400 });
  }

  const instruction =
    `Convert the student's request into functions to plot on a 2D grapher. ` +
    `Output ONLY a JSON array of strings — no words, no markdown. Each string is a ` +
    `math expression in terms of x using this syntax: ^ for powers, ln(x) for ` +
    `natural log, log(x,10) for base-10, e^x, sqrt(x), abs(x), sin/cos/tan(x), pi, e. ` +
    `Do not include "y=". If the request mentions a limit, output the underlying ` +
    `function of x (a limit is a single value, not a curve). Give at most 4 functions. ` +
    `Examples: request "parabola x squared minus 3" -> ["x^2 - 3"]; ` +
    `request "natural log and its reciprocal" -> ["ln(x)","1/x"]. ` +
    `Student request: "${prompt}"`;

  try {
    const { response } = await chatWithTutor({
      actor: usageActor(user),
      message: instruction,
      history: [],
      content:
        "You translate natural-language math requests into plottable expressions in x. Reply with a JSON array of strings only.",
      chapterTitle: "Graphing",
      subject: "Mathematics",
      grade: 10,
    });

    const equations = parseEquations(response);
    if (equations.length === 0) {
      return NextResponse.json(
        { error: "Couldn't turn that into a graph — try rephrasing." },
        { status: 422 },
      );
    }
    return NextResponse.json({ equations });
  } catch {
    return NextResponse.json(
      { error: "AI is unavailable right now. Please try again." },
      { status: 502 },
    );
  }
}
