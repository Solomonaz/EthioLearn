/**
 * Conversational Query Rewriter for RAG Retrieval — §4.4.2
 *
 * Transforms context-dependent follow-up questions (e.g., "Why does it do that?",
 * "Where are they located?") into standalone search queries using conversation
 * history, so pgvector semantic search retrieves the correct textbook passages.
 */

import { geminiChat, GEMINI_FAST_MODEL } from "./gemini";
import { groqChat } from "./groq";
import type { UsageActor } from "./usage-logger";

export interface QueryRewriteOptions {
  message: string;
  history?: { role: "user" | "model"; parts: { text: string }[] }[];
  subject?: string;
  chapterTitle?: string;
  actor?: UsageActor;
}

// Common conversational phrases that don't need rewriting or semantic search
const CASUAL_PHRASES = new Set([
  "hi",
  "hello",
  "hey",
  "greetings",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "yes",
  "no",
  "good morning",
  "good afternoon",
  "bye",
  "goodbye",
]);

/**
 * Rewrites a student's follow-up message into a standalone search query.
 * Fast, fail-safe, and zero overhead for first-turn questions.
 */
export async function rewriteQueryForRAG(opts: QueryRewriteOptions): Promise<string> {
  const { message, history = [], subject, chapterTitle, actor } = opts;
  const trimmed = message.trim();

  // 1. If history is empty, the question is already the initial query — no rewriting needed.
  if (!history || history.length === 0 || !trimmed) {
    return trimmed;
  }

  // 2. Short-circuit on casual conversational phrases
  if (CASUAL_PHRASES.has(trimmed.toLowerCase().replace(/[.!?]/g, ""))) {
    return trimmed;
  }

  // 3. Take up to the last 4 turns (2 back-and-forth pairs) for context
  const recentHistory = history.slice(-4);
  const historyText = recentHistory
    .map((h) => {
      const role = h.role === "user" ? "Student" : "Tutor";
      const text = h.parts.map((p) => p.text).join(" ").trim();
      return `${role}: ${text.slice(0, 300)}`; // cap each history turn to 300 chars
    })
    .join("\n");

  const prompt = `You are a search query optimizer for an educational textbook search engine.
TASK: Rewrite the student's LATEST question into a clear, standalone search query that can be matched against textbook embeddings.

RULES:
1. Replace all pronouns ("it", "they", "this", "that", "the process", "why does that happen") with the specific concept or subject discussed in the conversation history.
2. Keep it concise, keyword-rich, and directly relevant to the curriculum.
3. If the question is already fully standalone and mentions its subject, return it as-is.
4. Do NOT answer the question. Return ONLY the search query string without quotes, explanations, or punctuation at the end.

SUBJECT: ${subject || "General"}
CHAPTER: ${chapterTitle || "General"}

CONVERSATION HISTORY:
${historyText}

LATEST STUDENT QUESTION:
"${trimmed}"

STANDALONE SEARCH QUERY:`;

  try {
    // Timeout guard: 2500ms max so the chat turn never stalls
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 2500)
    );

    // Try Gemini fast model first (gemini-3.1-flash-lite)
    const geminiPromise = geminiChat(prompt, {
      model: GEMINI_FAST_MODEL,
      temperature: 0.0,
      maxTokens: 80,
      feature: "tutor-chat",
      actor,
    });

    let rewritten = await Promise.race([geminiPromise, timeoutPromise]);

    // Fallback to Groq if Gemini failed or timed out
    if (!rewritten && process.env.GROQ_API_KEY) {
      const groqPromise = groqChat(prompt, {
        temperature: 0.0,
        maxTokens: 80,
        feature: "tutor-chat",
        actor,
      });
      rewritten = await Promise.race([groqPromise, timeoutPromise]);
    }

    if (rewritten && typeof rewritten === "string") {
      const clean = rewritten.replace(/^["']|["']$/g, "").trim();
      if (clean.length >= 3 && clean.length <= 200) {
        return clean;
      }
    }
  } catch (err) {
    console.warn("[Query Rewriter] Rewriting failed, using raw query:", err);
  }

  // Graceful fallback to original message
  return trimmed;
}
