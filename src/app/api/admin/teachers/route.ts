import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { validateCsrfOrigin } from "@/lib/csrf";
import {
  canonicalizeClasses,
  normalizePhone,
  parseClasses,
} from "@/lib/teacher-classes";

/**
 * Secondary teacher provisioning (grades 9-12) — SUPER_ADMIN and SCHOOL_ADMIN.
 *
 * This endpoint is SECONDARY-ONLY, on purpose. Elementary and secondary are
 * separate institutions with separate admins: a secondary school's admin must
 * never see or create a grades 1-8 teacher. The grades 1-8 platform keeps its
 * own existing flow and is not touched from here.
 *
 * Teachers are created by an admin rather than self-registering, so `schoolId`
 * is authoritative instead of self-claimed — every school-scoped cohort query
 * downstream depends on that.
 *
 * Mirrors the scoping convention of /api/admin/students: a school admin acts
 * inside their own school; a super admin may target any school (or none).
 */

const ADMIN_ROLES = ["SUPER_ADMIN", "SCHOOL_ADMIN"];

// ─── POST: create one secondary teacher ──────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json(
      { error: "School admin account not configured" },
      { status: 403 },
    );
  }

  let body: {
    name?: string;
    phone?: string;
    phoneNumber?: string;
    schoolId?: string | null;
    assignments?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 50) {
    return NextResponse.json(
      { error: "Please enter the teacher's full name (2-50 characters)." },
      { status: 400 },
    );
  }

  const phoneNumber = normalizePhone(String(body.phone ?? body.phoneNumber ?? ""));
  if (!phoneNumber) {
    return NextResponse.json(
      { error: "Enter a valid Ethiopian phone number (e.g. 9XXXXXXXX)." },
      { status: 400 },
    );
  }

  const parsed = parseClasses(body.assignments);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const classes = await canonicalizeClasses(parsed.classes);

  // ── School scope ──────────────────────────────────────────────────────
  // A school admin always provisions into their own school; the body cannot
  // override it. A super admin may name any school, or leave it unassigned.
  let schoolId: string | null;
  if (user.role === "SCHOOL_ADMIN") {
    schoolId = user.schoolId;
  } else {
    schoolId = typeof body.schoolId === "string" && body.schoolId ? body.schoolId : null;
    if (schoolId) {
      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { id: true },
      });
      if (!school) {
        return NextResponse.json({ error: "School not found." }, { status: 404 });
      }
    }
  }

  const existing = await db.user.findUnique({
    where: { phoneNumber },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this phone number already exists." },
      { status: 409 },
    );
  }

  // The row is created before the teacher ever signs in; they then log in with
  // this phone number over the normal OTP flow.
  const teacher = await db.user.create({
    data: {
      name,
      phoneNumber,
      role: "SECONDARY_TEACHER",
      schoolId,
      teachingAssignments: classes.length
        ? {
            create: classes.map((p) => ({
              subject: p.subject,
              grade: p.grade,
              section: p.section,
            })),
          }
        : undefined,
    },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      role: true,
      isActive: true,
      createdAt: true,
      school: { select: { id: true, name: true } },
      teachingAssignments: {
        orderBy: [{ grade: "asc" }, { subject: "asc" }, { section: "asc" }],
        select: { id: true, subject: true, grade: true, section: true },
      },
    },
  });

  return NextResponse.json({ teacher }, { status: 201 });
}

// ─── GET: list secondary teachers in scope ───────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rl = rateLimit("admin:teachers:" + user.id, 60, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json(
      { error: "School admin account not configured" },
      { status: 403 },
    );
  }

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

  const where = {
    // Secondary only — grades 1-8 teachers belong to a different institution
    // and are never listed here.
    role: "SECONDARY_TEACHER" as const,
    // A school admin sees only their own school; a super admin sees everyone.
    ...(user.schoolId ? { schoolId: user.schoolId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { phoneNumber: { contains: search } },
          ],
        }
      : {}),
  };

  const [teachers, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        email: true,
        role: true,
        isActive: true,
        lastActiveAt: true,
        createdAt: true,
        school: { select: { id: true, name: true } },
        teachingAssignments: {
          orderBy: [{ grade: "asc" }, { subject: "asc" }, { section: "asc" }],
          select: { id: true, subject: true, grade: true, section: true },
        },
      },
    }),
    db.user.count({ where }),
  ]);

  return NextResponse.json({
    teachers,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
}
