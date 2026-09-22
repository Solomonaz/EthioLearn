/**
 * Admin AI model configuration.
 *
 * SUPER_ADMIN only: this is platform-wide infrastructure, not per-school
 * settings, and a bad value here degrades AI for every school at once.
 *
 * Note what this endpoint deliberately never accepts: an API key. Keys stay in
 * the environment. The response reports only whether each key is PRESENT, so an
 * admin can diagnose "no key" without the key ever reaching a browser, a
 * database row or a backup.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { db } from "@/lib/db";
import {
  getProviderSettings,
  refreshModelCache,
  PROVIDER_META,
  ALL_PROVIDERS,
  type AiProviderId,
} from "@/lib/ai-settings";

async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== "SUPER_ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  const providers = await getProviderSettings();
  return NextResponse.json({
    providers: providers.map((p) => ({
      ...p,
      keyEnv: PROVIDER_META[p.id].keyEnv,
      defaultBaseUrl: PROVIDER_META[p.id].defaultBaseUrl,
      defaultPriority: PROVIDER_META[p.id].defaultPriority,
      defaults: PROVIDER_META[p.id].defaults,
    })),
  });
}

interface ProviderPatch {
  id: AiProviderId;
  enabled?: boolean;
  priority?: number;
  chatModel?: string | null;
  fastModel?: string | null;
  embeddingModel?: string | null;
  baseUrl?: string | null;
}

/** Empty string from a form means "clear the override", not "set to empty". */
function normalise(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function PUT(req: NextRequest) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  let body: { providers?: ProviderPatch[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patches = Array.isArray(body.providers) ? body.providers : [];
  if (patches.length === 0) {
    return NextResponse.json({ error: "No providers supplied." }, { status: 400 });
  }
  for (const p of patches) {
    if (!ALL_PROVIDERS.includes(p.id)) {
      return NextResponse.json({ error: `Unknown provider: ${p.id}` }, { status: 400 });
    }
    if (p.priority !== undefined && (!Number.isFinite(p.priority) || p.priority < 0 || p.priority > 999)) {
      return NextResponse.json({ error: "Priority must be between 0 and 999." }, { status: 400 });
    }
  }

  // Refuse a configuration that would leave nothing able to serve a request.
  // Better a clear rejection now than a 500 on the next question generation.
  const current = await getProviderSettings();
  const after = current.map((c) => {
    const patch = patches.find((p) => p.id === c.id);
    if (!patch) return c;
    return {
      ...c,
      enabled: patch.enabled ?? c.enabled,
      models: {
        ...c.models,
        chat: patch.chatModel !== undefined ? normalise(patch.chatModel) ?? c.models.chat : c.models.chat,
      },
    };
  });
  if (!after.some((p) => p.enabled && p.hasKey && p.models.chat)) {
    return NextResponse.json(
      { error: "At least one provider must stay enabled, keyed and given a model — otherwise all AI features stop." },
      { status: 400 }
    );
  }

  await db.$transaction(
    patches.map((p) => {
      const data = {
        ...(p.enabled !== undefined ? { enabled: !!p.enabled } : {}),
        ...(p.priority !== undefined ? { priority: Math.round(p.priority) } : {}),
        ...(p.chatModel !== undefined ? { chatModel: normalise(p.chatModel) } : {}),
        ...(p.fastModel !== undefined ? { fastModel: normalise(p.fastModel) } : {}),
        ...(p.embeddingModel !== undefined ? { embeddingModel: normalise(p.embeddingModel) } : {}),
        ...(p.baseUrl !== undefined ? { baseUrl: normalise(p.baseUrl) } : {}),
      };
      return db.aiProviderConfig.upsert({
        where: { id: p.id },
        create: { id: p.id, priority: PROVIDER_META[p.id].defaultPriority, ...data },
        update: data,
      });
    })
  );

  // Apply immediately: the synchronous model cache the provider libraries read
  // is otherwise only refreshed on the next chain operation.
  await refreshModelCache();

  return NextResponse.json({ providers: await getProviderSettings() });
}
