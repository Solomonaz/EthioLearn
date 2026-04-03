import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { chatWithTutor } from "@/lib/ai-provider";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { chapterId, message, history = [] } = await req.json();

    if (!chapterId || !message) {
      return NextResponse.json({ error: "Chapter ID and message are required" }, { status: 400 });
    }

    // 1. Fetch Chapter Content
    const chapter = await db.chapter.findUnique({
      where: { id: chapterId },
      include: {
        textbook: true,
      },
    });

    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }

    // 2. Chat with Tutor
    const result = await chatWithTutor({
      message,
      history,
      content: chapter.content || chapter.textbook.content || "",
      chapterTitle: chapter.title,
      subject: chapter.textbook.subject,
      grade: chapter.textbook.grade,
    });

    return NextResponse.json({
      response: result.response,
      provider: result.provider,
    });
  } catch (error) {
    console.error("[Tutor API Error]", error);
    return NextResponse.json({ error: "Failed to generate tutor response" }, { status: 500 });
  }
}
