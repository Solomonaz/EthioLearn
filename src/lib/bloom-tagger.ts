/**
 * Bloom's Taxonomy Tagger — §4.4.2
 *
 * AI-powered classification of content chunks into Bloom's Taxonomy levels:
 *   Remember → Understand → Apply → Analyze → Evaluate → Create
 *
 * Batch processes multiple chunks in a single AI call for efficiency.
 * Provider priority: Ollama Mistral → Gemini → default "Understand".
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ollamaChat } from "./ollama";

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

function buildBloomTaggingPrompt(
  chunks: { chunkIndex: number; content: string }[],
  subject: string,
  grade: number
): string {
  const chunkList = chunks
    .map(
      (c) =>
        `CHUNK ${c.chunkIndex}:\n"""${c.content.slice(0, 1500)}"""`
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

// ─── Per-batch AI call with provider chain ──────────────

async function tagBatch(
  batch: { chunkIndex: number; content: string }[],
  subject: string,
  grade: number
): Promise<BloomTagResult[]> {
  const expectedIndices = batch.map((c) => c.chunkIndex);
  const prompt = buildBloomTaggingPrompt(batch, subject, grade);

  // 1. Ollama Mistral (local, no quota)
  try {
    const raw = await ollamaChat(prompt);
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

  // 3. Default fallback
  console.warn("[Bloom Tagger] All providers failed — assigning default 'Understand'.");
  return batch.map((c) => ({ chunkIndex: c.chunkIndex, bloomLevel: "Understand" as BloomLevel, confidence: 0 }));
}

// ─── Main: Tag Chunks with Bloom's Levels ───────────────

/**
 * Tag multiple chunks with Bloom's Taxonomy levels in a single AI call.
 * Provider priority: Ollama Mistral → Gemini → default "Understand".
 * Processes in batches of 50 chunks.
 */
export async function tagChunksWithBloomLevel(
  chunks: { chunkIndex: number; content: string }[],
  subject: string,
  grade: number
): Promise<BloomTagResult[]> {
  if (chunks.length === 0) return [];

  const BATCH_SIZE = 50;
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
