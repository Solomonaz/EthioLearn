/**
 * Which Gemini backend the current call goes to.
 *
 * The same Gemini models are served two ways:
 *   • AI Studio (Gemini Developer API, generativelanguage.googleapis.com) —
 *     provider GEMINI, key GEMINI_API_KEY.
 *   • Google Cloud Agent Platform (Vertex AI, aiplatform.googleapis.com) —
 *     provider GEMINI_VERTEX, key GEMINI_VERTEX_API_KEY. Billed to the Cloud
 *     project, so Google Cloud credits apply to it, where they do not apply
 *     to AI Studio's paid tier.
 *
 * The request and response bodies are the same, so lib/gemini.ts serves both.
 * Rather than thread a backend parameter through every Gemini helper, the
 * router runs a GEMINI_VERTEX step inside `withGeminiBackend("vertex", …)` and
 * the helpers ask `activeGeminiBackend()` — the same AsyncLocalStorage pattern
 * as `withModelOverride` in ai-settings.
 *
 * Embeddings never use this: they stay on AI Studio (lib/embeddings), so every
 * vector in the index comes from one model.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { AiProviderId } from "@prisma/client";

export type GeminiBackend = "studio" | "vertex";

const backendScope = new AsyncLocalStorage<GeminiBackend>();

/** Run `fn` with every Gemini call inside it sent to `backend`. */
export function withGeminiBackend<T>(backend: GeminiBackend, fn: () => Promise<T>): Promise<T> {
  return backendScope.run(backend, fn);
}

export function activeGeminiBackend(): GeminiBackend {
  return backendScope.getStore() ?? "studio";
}

/** The provider id whose settings (models, key) the active backend uses. */
export function geminiProviderId(): Extract<AiProviderId, "GEMINI" | "GEMINI_VERTEX"> {
  return activeGeminiBackend() === "vertex" ? "GEMINI_VERTEX" : "GEMINI";
}

/** API key for the active backend, or undefined when it is not set. */
export function geminiApiKey(): string | undefined {
  const key =
    activeGeminiBackend() === "vertex"
      ? process.env.GEMINI_VERTEX_API_KEY
      : process.env.GEMINI_API_KEY;
  return key?.trim() || undefined;
}

/** Provider name recorded on usage events, so spend is split per backend. */
export function geminiUsageProvider(): "gemini" | "gemini-vertex" {
  return activeGeminiBackend() === "vertex" ? "gemini-vertex" : "gemini";
}

export const DEFAULT_VERTEX_BASE_URL = "https://aiplatform.googleapis.com/v1";

/**
 * Agent Platform base URL, split into the two parts the Gemini SDK takes:
 * `https://aiplatform.googleapis.com/v1` -> { baseUrl: "https://aiplatform.googleapis.com", apiVersion: "v1" }.
 */
export function vertexEndpoint(): { baseUrl: string; apiVersion: string } {
  const raw = (process.env.GEMINI_VERTEX_BASE_URL?.trim() || DEFAULT_VERTEX_BASE_URL).replace(/\/+$/, "");
  const cut = raw.lastIndexOf("/");
  const tail = raw.slice(cut + 1);
  if (cut > "https://".length && /^v\d/.test(tail)) {
    return { baseUrl: raw.slice(0, cut), apiVersion: tail };
  }
  return { baseUrl: raw, apiVersion: "v1" };
}

/** Agent Platform names Google's models as publishers/google/models/<id>. */
export function vertexModelPath(model: string): string {
  return model.includes("/") ? model : `publishers/google/models/${model}`;
}
