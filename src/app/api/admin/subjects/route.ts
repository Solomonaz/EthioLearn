import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user.role !== "SUPER_ADMIN" && session.user.role !== "SCHOOL_ADMIN")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { name } = await req.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const subject = await db.subject.create({
      data: { name: name.trim() },
    });

    return NextResponse.json({ subject });
  } catch (error: any) {
    console.error("Failed to create subject:", error);
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Subject already exists" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create subject" }, { status: 500 });
  }
}
