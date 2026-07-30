/**
 * Bloom's Taxonomy Tagger — §4.4.2
 *
 * AI-powered classification of content chunks into Bloom's Taxonomy levels:
 *   Remember → Understand → Apply → Analyze → Evaluate → Create
 *
 * Batch processes multiple chunks in a single AI call for efficiency.
 * Provider priority: Groq → Gemini → Ollama (remote only) → default "Understand".
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ollamaChat, isOllamaEnabled } from "./ollama";
import { groqChat } from "./groq";

// ─── Types ──────────────────────────────────────────────

export type BloomLevel =
  | "Remember"
  | "Understand"
  | "Apply"
  | "Analyze"
  | "Evaluate"
  | "Create";

export const BLOOM_LEVELS: BloomLevel[] = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

export interface BloomTagResult {
  chunkIndex: number;
  bloomLevel: BloomLevel;
  confidence: number; // 0-1
}

// ─── Client ─────────────────────────────────────────────

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for Bloom tagging.");
  return new GoogleGenerativeAI(apiKey);
}

// ─── Prompt ─────────────────────────────────────────────

// Bloom level reflects the *type* of cognitive demand, which the opening of a
// chunk establishes — the full 1500-char body isn't needed and triples token
// cost (a single 15-chunk batch was ~6k tokens, exhausting Groq's 100k/day cap
// on one textbook). A short sample keeps the whole book well within budget.
const CHUNK_SAMPLE_CHARS = 500;

function buildBloomTaggingPrompt(
  chunks: { chunkIndex: number; content: string }[],
  subject: string,
  grade: number
): string {
  const chunkList = chunks
    .map(
      (c) =>
        `CHUNK ${c.chunkIndex}:\n"""${c.content.slice(0, CHUNK_SAMPLE_CHARS)}"""`
    )
    .join("\n\n");

  return `You are an expert in Bloom's Taxonomy and educational content analysis for the Ethiopian curriculum.

TASK: Classify each of the following textbook content chunks into the most appropriate Bloom's Taxonomy level.

SUBJECT: ${subject}
GRADE: Grade ${grade}

BLOOM'S TAXONOMY LEVELS (in order of cognitive complexity):
1. **Remember** — Recalling facts, definitions, terms, basic concepts
2. **Understand** — Explaining ideas, interpreting, summarizing, paraphrasing
3. **Apply** — Using information in new situations, solving problems, demonstrating
4. **Analyze** — Breaking information into parts, comparing, contrasting, examining relationships
5. **Evaluate** — Justifying decisions, critiquing, assessing value, making judgments
6. **Create** — Producing new work, designing, constructing, planning, inventing

RULES:
1. Assign the DOMINANT cognitive level based on what type of learning the content primarily supports.
2. If content contains definitions and facts → Remember.
3. If content explains concepts with examples → Understand.
4. If content shows how to solve problems or apply methods → Apply.
5. If content compares, contrasts, or examines cause-effect → Analyze.
6. If content involves evaluation criteria or judgment → Evaluate.
7. If content involves design, synthesis, or creative tasks → Create.
8. Include a confidence score from 0.0 to 1.0.

OUTPUT FORMAT: Return a JSON object with key "tags" containing an array. Each element:
- "chunkIndex": number
- "bloomLevel": one of "Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"
- "confidence": number between 0.0 and 1.0

CONTENT CHUNKS:
${chunkList}

Classify each chunk now. Return JSON only.`;
}

// ─── Validation ──────────────────────────────────────────

function validateBloomTags(raw: unknown, expectedChunks: number[]): BloomTagResult[] {
  if (!raw || typeof raw !== "object") return [];

  const data = raw as Record<string, unknown>;
  const tags = Array.isArray(data.tags) ? data.tags : Array.isArray(raw) ? raw : [];

  const validated: BloomTagResult[] = [];

  for (const item of tags) {
    if (!item || typeof item !== "object") continue;
    const tag = item as Record<string, unknown>;

    const chunkIndex = Number(tag.chunkIndex);
    if (!expectedChunks.includes(chunkIndex)) continue;

    const bloomLevel = String(tag.bloomLevel);
    if (!BLOOM_LEVELS.includes(bloomLevel as BloomLevel)) continue;

    const confidence = Number(tag.confidence);

    validated.push({
      chunkIndex,
      bloomLevel: bloomLevel as BloomLevel,
      confidence: isNaN(confidence) ? 0.7 : Math.min(1, Math.max(0, confidence)),
    });
  }

  return validated;
}

// ─── Heuristic fallback (zero-cost, offline) ────────────
// When every AI provider is unavailable or rate-limited (e.g. Groq's daily
// token cap is hit mid-run), classify by the cognitive verbs/cues present in
// the text instead of blindly tagging every chunk "Understand" — which would
// silently flatten the whole Bloom distribution.

const BLOOM_CUES: Record<BloomLevel, RegExp> = {
  Remember: /\b(defin|list|name|identif|recall|state|label|terminolog|what is|who was|when did)\b/i,
  Understand: /\b(explain|describ|summar|interpret|meaning|in other words|for example|illustrat|classif)\b/i,
  Apply: /\b(solve|calculat|comput|apply|demonstrat|how to|procedure|steps to|method to|use the)\b/i,
  Analyze: /\b(compar|contrast|analy|differ|caus|effect|relationship|examine|categor|distinguish|why did)\b/i,
  Evaluate: /\b(evaluat|justif|assess|critiqu|judg|argue|defend|advantages and disadvantages|significance|impact of)\b/i,
  Create: /\b(design|creat|construct|plan a|develop a|propose|invent|compose|formulat|imagine)\b/i,
};

function heuristicBloomLevel(content: string): BloomLevel {
  let best: BloomLevel = "Understand";
  let bestScore = 0;
  for (const level of BLOOM_LEVELS) {
    const matches = content.match(new RegExp(BLOOM_CUES[level].source, "gi"));
    const score = matches ? matches.length : 0;
    if (score > bestScore) {
      bestScore = score;
      best = level;
    }
  }
  return best;
}

// ─── Per-batch AI call with provider chain ──────────────

async function tagBatch(
  batch: { chunkIndex: number; content: string }[],
  subject: string,
  grade: number
): Promise<BloomTagResult[]> {
  const expectedIndices = batch.map((c) => c.chunkIndex);
  const prompt = buildBloomTaggingPrompt(batch, subject, grade);

  // 1. Groq — fastest cloud provider, primary
  try {
    const raw = await groqChat(prompt, {
      system:
        "You are an expert in Bloom's Taxonomy. Always respond with valid JSON only.",
      temperature: 0.2,
      maxTokens: 2048,
    });
    if (raw) {
      const tags = validateBloomTags(JSON.parse(raw), expectedIndices);
      if (tags.length > 0) return tags;
    }
  } catch {
    // fall through
  }

  // 2. Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const client = getClient();
      const model = client.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 4096 },
      });
      const result = await model.generateContent(prompt);
      const tags = validateBloomTags(JSON.parse(result.response.text()), expectedIndices);
      if (tags.length > 0) return tags;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("429")) {
        console.warn("[Bloom Tagger] Gemini rate-limited.");
      }
    }
  }

  // 3. Ollama Mistral — only when pointed at a real (non-localhost) host, and
  //    with a short timeout so a slow/hung local model can't stall the pipeline.
  if (isOllamaEnabled()) {
    try {
      const raw = await ollamaChat(prompt, 30_000);
      if (raw) {
        const tags = validateBloomTags(JSON.parse(raw), expectedIndices);
        if (tags.length > 0) {
          console.info("[Bloom Tagger] Used Ollama Mistral.");
          return tags;
        }
      }
    } catch {
      // fall through
    }
  }

  // 4. Heuristic fallback — all AI providers exhausted/unavailable. Classify
  //    by keyword cues rather than flattening everything to "Understand".
  console.warn("[Bloom Tagger] All AI providers unavailable — using heuristic keyword classifier.");
  return batch.map((c) => ({
    chunkIndex: c.chunkIndex,
    bloomLevel: heuristicBloomLevel(c.content),
    confidence: 0.3,
  }));
}

// ─── Main: Tag Chunks with Bloom's Levels ───────────────

/**
 * Tag multiple chunks with Bloom's Taxonomy levels in a single AI call.
 * Provider priority: Groq → Gemini → Ollama (remote only) → default "Understand".
 *
 * Batches are kept small so each prompt stays modest and the JSON output stays
 * well under the model's output-token cap (a batch too large truncates the
 * response, fails to parse, and silently defaults every chunk to "Understand").
 */
export async function tagChunksWithBloomLevel(
  chunks: { chunkIndex: number; content: string }[],
  subject: string,
  grade: number
): Promise<BloomTagResult[]> {
  if (chunks.length === 0) return [];

  const BATCH_SIZE = 15;
  const allResults: BloomTagResult[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const tags = await tagBatch(batch, subject, grade);
    allResults.push(...tags);
  }

  return allResults;
}

/**
 * Tag a single question with its Bloom's Taxonomy level.
 */
export async function tagQuestionBloomLevel(
  questionText: string,
  subject: string,
  grade: number
): Promise<{ bloomLevel: BloomLevel; confidence: number }> {
  const results = await tagChunksWithBloomLevel(
    [{ chunkIndex: 0, content: questionText }],
    subject,
    grade
  );

  return results.length > 0
    ? { bloomLevel: results[0].bloomLevel, confidence: results[0].confidence }
    : { bloomLevel: "Understand", confidence: 0 };
}
