/**
 * Live provider health check.
 *
 * Sends the smallest real request each provider accepts, against the model id
 * that is CURRENTLY configured — so the result answers the question an admin
 * actually has: "is the thing my system will call in a moment working, and if
 * not, is it out of quota or is the model gone?"
 *
 * Probing a hardcoded model would be worse than useless: it could report "ok"
 * while the configured model is retired.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { probeAll } from "@/lib/ai-health";
import { ALL_PROVIDERS, type AiProviderId } from "@/lib/ai-settings";

export async function POST(req: NextRequest) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Each check spends a real (tiny) request at every provider. Bounded so a
  // held-down button cannot burn quota on the very providers it is testing.
  const rl = rateLimit(`admin:ai-check:${user.id}`, 10, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many checks — wait a moment before testing again." },
      { status: 429 }
    );
  }

  let ids: AiProviderId[] | undefined;
  let models: Partial<Record<AiProviderId, string>> | undefined;
  try {
    const body = (await req.json()) as {
      ids?: AiProviderId[];
      models?: Partial<Record<AiProviderId, string>>;
    };
    if (Array.isArray(body?.ids)) {
      ids = body.ids.filter((i): i is AiProviderId => ALL_PROVIDERS.includes(i));
    }
    // Model ids the admin has typed but not yet saved — test those, so the
    // button reports on what is on screen.
    if (body?.models && typeof body.models === "object") {
      models = {};
      for (const [k, v] of Object.entries(body.models)) {
        if (ALL_PROVIDERS.includes(k as AiProviderId) && typeof v === "string" && v.trim()) {
          models[k as AiProviderId] = v.trim();
        }
      }
    }
  } catch {
    // No body means "check everything".
  }

  const results = await probeAll(ids, models);
  return NextResponse.json({ results, checkedAt: new Date().toISOString() });
}
