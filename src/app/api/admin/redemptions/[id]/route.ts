import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { notifyRewardApproved, createNotification } from "@/lib/notifications";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ApproveBody {
  action?: "approve" | "deny" | "fulfill";
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { id } = await params;

  let body: ApproveBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action } = body;

  if (!action || !["approve", "deny", "fulfill"].includes(action)) {
    return NextResponse.json(
      { error: "action must be one of: approve, deny, fulfill" },
      { status: 400 }
    );
  }

  const redemption = await db.redemption.findUnique({
    where: { id },
    include: {
      reward: {
        select: {
          id: true,
          schoolId: true,
          pointsCost: true,
          name: true,
        },
      },
      student: {
        select: { id: true, name: true },
      },
    },
  });

  if (!redemption) {
    return NextResponse.json({ error: "Redemption not found" }, { status: 404 });
  }

  if (user.role === "SCHOOL_ADMIN" && redemption.reward.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (action === "approve") {
    if (redemption.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot approve a redemption with status: ${redemption.status}` },
        { status: 400 }
      );
    }

    const updated = await db.redemption.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: user.id,
      },
      include: {
        student: { select: { id: true, name: true, phoneNumber: true, grade: true, totalPoints: true } },
        reward: { select: { id: true, name: true, tier: true, pointsCost: true } },
        approvedBy: { select: { name: true } },
      },
    });

    // Notify student (fire-and-forget)
    notifyRewardApproved(redemption.studentId, redemption.reward.name).catch(console.error);

    return NextResponse.json({ redemption: updated });
  }

  if (action === "deny") {
    if (redemption.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot deny a redemption with status: ${redemption.status}` },
        { status: 400 }
      );
    }

    const [updated] = await db.$transaction([
      db.redemption.update({
        where: { id },
        data: {
          status: "DENIED",
          approvedById: user.id,
        },
        include: {
          student: { select: { id: true, name: true, phoneNumber: true, grade: true, totalPoints: true } },
          reward: { select: { id: true, name: true, tier: true, pointsCost: true } },
          approvedBy: { select: { name: true } },
        },
      }),
      db.user.update({
        where: { id: redemption.studentId },
        data: {
          totalPoints: { increment: redemption.reward.pointsCost },
        },
      }),
      // Restore inventory since the reward was never fulfilled
      db.reward.update({
        where: { id: redemption.rewardId },
        data: { inventoryCount: { increment: 1 } },
      }),
      db.pointLedger.create({
        data: {
          actionType: "REDEMPTION_REFUND",
          points: redemption.reward.pointsCost,
          description: `Refund for denied redemption of "${redemption.reward.name}"`,
          userId: redemption.studentId,
        },
      }),
    ]);

    // Notify student of denial (fire-and-forget)
    createNotification(
      redemption.studentId,
      "reward",
      "Redemption Denied",
      `Your redemption for "${redemption.reward.name}" was denied. ${redemption.reward.pointsCost} points have been refunded.`,
      { rewardName: redemption.reward.name, refunded: redemption.reward.pointsCost }
    ).catch(console.error);

    return NextResponse.json({ redemption: updated });
  }

  if (action === "fulfill") {
    if (redemption.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Can only fulfill redemptions that are currently APPROVED" },
        { status: 400 }
      );
    }

    const updated = await db.redemption.update({
      where: { id },
      data: { status: "FULFILLED" },
      include: {
        student: { select: { id: true, name: true, phoneNumber: true, grade: true, totalPoints: true } },
        reward: { select: { id: true, name: true, tier: true, pointsCost: true } },
        approvedBy: { select: { name: true } },
      },
    });

    // Notify student that their reward is ready (fire-and-forget)
    createNotification(
      redemption.studentId,
      "reward",
      "Reward Ready!",
      `Your "${redemption.reward.name}" reward has been fulfilled. Collect it from your school admin!`,
      { rewardName: redemption.reward.name }
    ).catch(console.error);

    return NextResponse.json({ redemption: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
