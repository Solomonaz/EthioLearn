import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { generateVideoTutorial } from "@/lib/ai-provider";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";

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

  // Rate limit: 5 video generations per minute per student
  const rl = rateLimit(`video:gen:${user.id}`, 5, 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before generating again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  try {
    const { chapterId, topic } = await req.json();

    if (!chapterId) {
      return NextResponse.json(
        { error: "chapterId is required" },
        { status: 400 }
      );
    }

    // Fetch chapter content + textbook metadata
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
        { error: "This chapter has no text content to generate a tutorial from." },
        { status: 422 }
      );
    }

    const { script, provider } = await generateVideoTutorial({
      content,
      chapterTitle: chapter.title,
      subject: chapter.textbook.subject,
      grade: chapter.textbook.grade,
      topic: topic || undefined,
    });

    return NextResponse.json({ script, provider });
  } catch (error) {
    console.error("[Video Tutorial API Error]", error);
    return NextResponse.json(
      { error: "Failed to generate video tutorial. Please try again." },
      { status: 500 }
    );
  }
}
