import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import {
  canonicalizeClasses,
  classKey,
  normalizePhone,
  parseClasses,
} from "@/lib/teacher-classes";

/**
 * PATCH /api/admin/teachers/[id]
 *
 * Update one teacher's account. SUPER_ADMIN and SCHOOL_ADMIN only, and a
 * school admin may only touch a teacher inside their own school.
 *
 * Editable: name, phone number, the classes they hold, and active/suspended
 * state. It can never change a ROLE, so this endpoint cannot be used to promote
 * anyone. Targets are SECONDARY_TEACHER accounts; a SUPER_ADMIN may also reach
 * a grades 1-8 TEACHER, but only to activate or deactivate them — their classes
 * live in the frozen grades 1-8 surface and are not edited from here. Admin
 * accounts are never reachable.
 *
 * Classes are DIFFED rather than replaced. Deleting and recreating every row on
 * each save would churn ids and, because ClassActivity.teachingAssignmentId is
 * SetNull, would quietly detach past homework from the class it was set for —
 * even when the teacher's classes had not actually changed.
 */

const ADMIN_ROLES = ["SUPER_ADMIN", "SCHOOL_ADMIN"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;

  let body: {
    name?: unknown;
    phone?: unknown;
    isActive?: unknown;
    suspendReason?: unknown;
    /** When present, the complete set of classes this teacher should hold. */
    assignments?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, schoolId: true },
  });

  // Same 404 for "does not exist", "not a secondary teacher" and "not yours",
  // so a school admin cannot probe for accounts outside their scope.
  const isElementary = target?.role === "TEACHER" && user.role === "SUPER_ADMIN";
  const outOfScope =
    !target ||
    (target.role !== "SECONDARY_TEACHER" && !isElementary) ||
    (user.role === "SCHOOL_ADMIN" && target.schoolId !== user.schoolId);
  if (outOfScope) {
    return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  }

  if (
    isElementary &&
    (body.name !== undefined || body.phone !== undefined || body.assignments !== undefined)
  ) {
    return NextResponse.json(
      { error: "Grades 1-8 teachers can only be activated or deactivated here." },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 50) {
      return NextResponse.json(
        { error: "Name must be between 2 and 50 characters." },
        { status: 400 },
      );
    }
    data.name = name;
  }

  // Phone is their login identity, so a change here is how an admin fixes a
  // number that was mistyped at provisioning and is locking the teacher out.
  if (body.phone !== undefined) {
    const phoneNumber = normalizePhone(String(body.phone ?? ""));
    if (!phoneNumber) {
      return NextResponse.json(
        { error: "Enter a valid Ethiopian phone number (e.g. 9XXXXXXXX)." },
        { status: 400 },
      );
    }
    const clash = await db.user.findFirst({
      where: { phoneNumber, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(
        { error: "Another account already uses that phone number." },
        { status: 409 },
      );
    }
    data.phoneNumber = phoneNumber;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be true or false." }, { status: 400 });
    }
    data.isActive = body.isActive;
    // getCurrentUser() treats a suspended account as unauthenticated, so the
    // two flags are kept in step rather than left to drift apart.
    if (body.isActive) {
      data.suspendedAt = null;
      data.suspendReason = null;
    } else {
      data.suspendedAt = new Date();
      data.suspendReason =
        typeof body.suspendReason === "string" && body.suspendReason.trim()
          ? body.suspendReason.trim().slice(0, 200)
          : "Deactivated by administrator";
    }
  }

  // ── Classes, diffed against what is stored ────────────────────────────
  let classPlan: { toCreate: { subject: string; grade: number; section: string }[]; toDeleteIds: string[] } | null =
    null;

  if (body.assignments !== undefined) {
    const parsed = parseClasses(body.assignments);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const wantedClasses = await canonicalizeClasses(parsed.classes);

    const existing = await db.teachingAssignment.findMany({
      where: { teacherId: id },
      select: { id: true, subject: true, grade: true, section: true },
    });

    // `classKey` lower-cases the subject, so a class whose only change is its
    // spelling is treated as unchanged and is not needlessly deleted and
    // recreated — which would drop its activity history.
    const wanted = new Map(wantedClasses.map((c) => [classKey(c), c]));
    const held = new Map(existing.map((e) => [classKey(e), e]));

    classPlan = {
      toCreate: wantedClasses.filter((c) => !held.has(classKey(c))),
      toDeleteIds: existing.filter((e) => !wanted.has(classKey(e))).map((e) => e.id),
    };
  }

  if (Object.keys(data).length === 0 && !classPlan) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // One transaction, so a teacher is never left half-edited — for example with
  // their old classes removed but the new ones not yet written.
  if (classPlan) {
    const { toCreate, toDeleteIds } = classPlan;
    await db.$transaction([
      ...(toDeleteIds.length
        ? [db.teachingAssignment.deleteMany({ where: { id: { in: toDeleteIds }, teacherId: id } })]
        : []),
      ...toCreate.map((c) =>
        db.teachingAssignment.create({
          data: { teacherId: id, subject: c.subject, grade: c.grade, section: c.section },
        }),
      ),
    ]);
  }

  const teacher = await db.user.update({
    where: { id },
    data,
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
      _count: { select: { hostedGameRooms: true } },
    },
  });

  const { _count, ...rest } = teacher;
  return NextResponse.json({ teacher: { ...rest, gamesHosted: _count.hostedGameRooms } });
}
