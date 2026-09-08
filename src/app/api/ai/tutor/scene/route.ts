import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { generateScene, validateScene } from "@/lib/ai-provider";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";

/**
 * One chapter can hold several scenes — a whole-chapter one plus a scene per
 * requested topic — so the cache key folds the topic into a stable form.
 * Whitespace and case must not create duplicate rows for the same request.
 */
function topicKeyOf(topic?: string): string {
  return (topic ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
}

/**
 * Generate an animated scene for a chapter — the successor to
 * /api/ai/tutor/video, which produced narrated slides.
 *
 * Guards mirror the video route exactly (entitlement, the `aiVideo`
 * kill-switch, and the same 5-per-minute budget) because this is the same
 * student-facing capability, just rendered as moving objects instead of
 * layouts. Sharing the flag means one switch still turns tutorials off.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ent = await getEntitlements(user);
  if (!ent.ai) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.ai, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }
  if (!(await isAiFeatureEnabled("aiVideo"))) {
    return NextResponse.json(
      { error: "Animated tutorials are currently turned off.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  const rl = rateLimit(`scene:gen:${user.id}`, 5, 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before generating again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  try {
    const { chapterId, topic, refresh } = await req.json();

    if (!chapterId) {
      return NextResponse.json({ error: "chapterId is required" }, { status: 400 });
    }

    const cleanTopic = typeof topic === "string" && topic.trim() ? topic.trim() : undefined;
    const topicKey = topicKeyOf(cleanTopic);

    // ── Cache hit ────────────────────────────────────────────────────────
    // Generating a scene costs a real AI call (~US$0.011) and several seconds.
    // Forty students opening the same chapter should pay for one generation,
    // not forty. `refresh: true` forces a new take when a scene is poor.
    if (refresh !== true) {
      const cached = await db.$queryRaw<{ data: unknown; provider: string }[]>`
        SELECT data, provider FROM generated_scenes
        WHERE "chapterId" = ${chapterId} AND "topicKey" = ${topicKey}
        LIMIT 1
      `;
      if (cached.length > 0) {
        // Re-validate on read: a row written by an older version of the schema
        // must not be trusted straight into the player. A stale row simply
        // falls through and is regenerated.
        const scene = validateScene(cached[0].data);
        if (scene) {
          return NextResponse.json({ scene, provider: cached[0].provider, cached: true });
        }
        console.warn(`[Scene API] Cached scene for ${chapterId} failed validation — regenerating.`);
      }
    }

    const chapter = await db.chapter.findUnique({
      where: { id: chapterId },
      include: { textbook: true },
    });
    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }

    const content = chapter.content || chapter.textbook.content || "";
    if (!content.trim()) {
      return NextResponse.json(
        { error: "This chapter has no text content to animate." },
        { status: 422 }
      );
    }

    const { scene, provider } = await generateScene({
      content,
      chapterTitle: chapter.title,
      subject: chapter.textbook.subject,
      grade: chapter.textbook.grade,
      topic: cleanTopic,
    });

    // Store for reuse. A failure to cache must not fail the request — the
    // student already has a working scene; the next viewer just pays again.
    try {
      await db.$executeRaw`
        INSERT INTO generated_scenes
          (id, "chapterId", "topicKey", title, data, provider, "createdAt", "updatedAt")
        VALUES
          (${randomUUID()}, ${chapterId}, ${topicKey}, ${scene.title},
           CAST(${JSON.stringify(scene)} AS jsonb), ${provider}, NOW(), NOW())
        ON CONFLICT ("chapterId", "topicKey") DO UPDATE SET
          title = EXCLUDED.title,
          data = EXCLUDED.data,
          provider = EXCLUDED.provider,
          "updatedAt" = NOW()
      `;
    } catch (err) {
      console.warn(
        `[Scene API] Could not cache scene: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return NextResponse.json({ scene, provider, cached: false });
  } catch (error) {
    console.error("[Scene API Error]", error);
    // Every provider either failed or returned something unrenderable. There is
    // deliberately NO fallback scene: showing a chemistry animation for a
    // history lesson would be worse than an honest failure.
    return NextResponse.json(
      { error: "Could not build an animated tutorial for this chapter. Please try again." },
      { status: 502 }
    );
  }
}
