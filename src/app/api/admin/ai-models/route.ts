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
import { Prisma } from "@prisma/client";
import {
  getProviderSettings,
  refreshModelCache,
  PROVIDER_META,
  ALL_PROVIDERS,
  type AiProviderId,
  type ResolvedProvider,
} from "@/lib/ai-settings";
import { getSavedChains, toProviderState } from "@/lib/ai-routing";
import {
  AI_TASKS,
  TASK_BY_ID,
  MAX_CHAIN_STEPS,
  isAiTask,
  sanitizeChain,
  stepStatus,
  type AiProvider,
  type AiTask,
  type RouteStep,
} from "@/lib/ai-tasks";
import { isOllamaEnabled } from "@/lib/ollama";

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

  try {
    return NextResponse.json(await snapshot());
  } catch (err) {
    return unreadable(err);
  }
}

/**
 * The saved settings could not be read. Say so, rather than answering with the
 * built-in defaults: a page showing defaults is indistinguishable from "my
 * changes were reset", and a save made from it would overwrite the real ones.
 */
function unreadable(err: unknown) {
  console.error("[AI Models] Could not read saved AI settings:", err);
  return NextResponse.json(
    {
      error:
        "Could not read the saved AI settings from the database, so nothing is shown rather than " +
        "showing defaults. Check that the database is running (and that `prisma db push` has been " +
        "run), then reload this page.",
    },
    { status: 503 }
  );
}

/** Everything the admin page renders: providers plus each task's saved chain. */
async function snapshot() {
  const [providers, routes] = await Promise.all([
    getProviderSettings({ strict: true }),
    getSavedChains({ strict: true }),
  ]);
  return {
    providers: providers.map((p) => ({
      ...p,
      keyEnv: PROVIDER_META[p.id].keyEnv,
      defaultBaseUrl: PROVIDER_META[p.id].defaultBaseUrl,
      defaultPriority: PROVIDER_META[p.id].defaultPriority,
      defaults: PROVIDER_META[p.id].defaults,
    })),
    /** Saved chains only; a task missing here is on its built-in default. */
    routes,
    /** Local Ollama is dev-only; the page greys it out when this is false. */
    ollamaEnabled: isOllamaEnabled(),
  };
}

/** Tasks that have at least one step able to run under these provider settings. */
function servableTasks(
  providers: ResolvedProvider[],
  routes: Partial<Record<AiTask, RouteStep[]>>
): Set<AiTask> {
  const byId = new Map(providers.map((p) => [p.id as AiProvider, toProviderState(p)]));
  const ollama = isOllamaEnabled();
  const out = new Set<AiTask>();
  for (const t of AI_TASKS) {
    const chain = routes[t.id] ?? t.defaultChain;
    if (chain.some((s) => !stepStatus(t.id, s, byId.get(s.provider), ollama).skip)) out.add(t.id);
  }
  return out;
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

  let body: { providers?: ProviderPatch[]; routes?: Record<string, RouteStep[] | null> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patches = Array.isArray(body.providers) ? body.providers : [];

  // Task routes: a chain replaces the saved one; null resets the task to its
  // built-in default. Reject anything malformed outright rather than silently
  // dropping steps — the admin should see exactly what was refused.
  const routePatches: { task: AiTask; chain: RouteStep[] | null }[] = [];
  if (body.routes !== undefined) {
    if (!body.routes || typeof body.routes !== "object" || Array.isArray(body.routes)) {
      return NextResponse.json({ error: "routes must be an object keyed by task." }, { status: 400 });
    }
    for (const [task, raw] of Object.entries(body.routes)) {
      if (!isAiTask(task)) {
        return NextResponse.json({ error: `Unknown task: ${task}` }, { status: 400 });
      }
      if (raw === null) {
        routePatches.push({ task, chain: null });
        continue;
      }
      const label = TASK_BY_ID[task].label;
      if (!Array.isArray(raw) || raw.length === 0) {
        return NextResponse.json({ error: `${label} needs at least one step.` }, { status: 400 });
      }
      if (raw.length > MAX_CHAIN_STEPS) {
        return NextResponse.json({ error: `${label} has more than ${MAX_CHAIN_STEPS} steps.` }, { status: 400 });
      }
      const chain = sanitizeChain(task, raw);
      if (chain.length !== raw.length) {
        return NextResponse.json(
          { error: `${label}: every step needs a provider that supports this task, and no step may repeat the same provider and model.` },
          { status: 400 }
        );
      }
      routePatches.push({ task, chain });
    }
  }

  if (patches.length === 0 && routePatches.length === 0) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
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
  let current: ResolvedProvider[];
  let currentRoutes: Partial<Record<AiTask, RouteStep[]>>;
  try {
    [current, currentRoutes] = await Promise.all([
      getProviderSettings({ strict: true }),
      getSavedChains({ strict: true }),
    ]);
  } catch (err) {
    return unreadable(err);
  }
  const after = current.map((c) => {
    const patch = patches.find((p) => p.id === c.id);
    if (!patch) return c;
    return {
      ...c,
      enabled: patch.enabled ?? c.enabled,
      models: {
        ...c.models,
        chat: patch.chatModel !== undefined ? normalise(patch.chatModel) ?? c.models.chat : c.models.chat,
        fast: patch.fastModel !== undefined ? normalise(patch.fastModel) ?? c.models.fast : c.models.fast,
      },
    };
  });
  if (!after.some((p) => p.enabled && p.hasKey && p.models.chat)) {
    return NextResponse.json(
      { error: "At least one provider must stay enabled, keyed and given a model — otherwise all AI features stop." },
      { status: 400 }
    );
  }

  // Refuse a save that leaves a task that works today with no runnable step —
  // e.g. disabling Gemini while Vision lists only Gemini. Tasks that already
  // could not run are not blocked on, so a missing key elsewhere never makes
  // the whole page unsaveable.
  const routesAfter = { ...currentRoutes };
  for (const r of routePatches) {
    if (r.chain) routesAfter[r.task] = r.chain;
    else delete routesAfter[r.task];
  }
  const servableBefore = servableTasks(current, currentRoutes);
  const servableAfter = servableTasks(after, routesAfter);
  const broken = [...servableBefore].filter((t) => !servableAfter.has(t));
  if (broken.length) {
    return NextResponse.json(
      {
        error:
          `This would leave ${broken.map((t) => TASK_BY_ID[t].label).join(", ")} with no provider able to run. ` +
          "Add a working step to that task, or keep its provider enabled.",
      },
      { status: 400 }
    );
  }

  await db.$transaction([
    ...patches.map((p) => {
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
    }),
    ...routePatches.map((r) =>
      r.chain
        ? db.aiTaskRoute.upsert({
            where: { task: r.task },
            create: { task: r.task, chain: r.chain as unknown as Prisma.InputJsonValue },
            update: { chain: r.chain as unknown as Prisma.InputJsonValue },
          })
        : db.aiTaskRoute.deleteMany({ where: { task: r.task } })
    ),
  ]);

  // Apply immediately: the synchronous model cache the provider libraries read
  // is otherwise only refreshed on the next chain operation.
  await refreshModelCache();

  try {
    return NextResponse.json(await snapshot());
  } catch (err) {
    return unreadable(err);
  }
}
