"use client";

import { useEffect, useState, useCallback } from "react";
import { Gift, Coins, CheckCircle, Clock, XCircle, Award } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import { useEntitlements } from "@/hooks/use-entitlements";

// ─── Types ────────────────────────────────────────────────────────────────────

type RewardTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";
type RedemptionStatus = "PENDING" | "APPROVED" | "DENIED" | "FULFILLED";

interface Reward {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  tier: RewardTier;
  imageUrl: string | null;
  inventoryCount: number;
  createdAt: string;
}

interface RedemptionSummary {
  id: string;
  rewardId: string;
  status: RedemptionStatus;
  createdAt: string;
}

interface RewardsData {
  rewards: Reward[];
  userPoints: number; // redeemable (prize-eligible) balance
  totalPoints?: number; // leaderboard score, for context
  qualityThreshold?: number; // min quiz score that earns redeemable points
  redemptions: RedemptionSummary[];
}

// ─── Tier config ──────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<
  RewardTier,
  { label: string; badgeClass: string; gradientClass: string }
> = {
  BRONZE: {
    label: "Bronze",
    badgeClass: "bg-amber-100 text-amber-700",
    gradientClass: "from-amber-200 to-amber-400",
  },
  SILVER: {
    label: "Silver",
    badgeClass: "bg-gray-100 text-gray-600",
    gradientClass: "from-gray-200 to-gray-400",
  },
  GOLD: {
    label: "Gold",
    badgeClass: "bg-yellow-100 text-yellow-700",
    gradientClass: "from-yellow-200 to-yellow-400",
  },
  PLATINUM: {
    label: "Platinum",
    badgeClass: "bg-purple-100 text-purple-700",
    gradientClass: "from-purple-200 to-purple-400",
  },
};

const REDEMPTION_STATUS_CONFIG: Record<
  RedemptionStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  PENDING: {
    label: "Pending",
    icon: <Clock className="h-3.5 w-3.5" />,
    className: "bg-yellow-100 text-yellow-700",
  },
  APPROVED: {
    label: "Approved",
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    className: "bg-green-100 text-green-700",
  },
  DENIED: {
    label: "Denied",
    icon: <XCircle className="h-3.5 w-3.5" />,
    className: "bg-red-100 text-red-700",
  },
  FULFILLED: {
    label: "Fulfilled",
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    className: "bg-blue-100 text-blue-700",
  },
};

const TIER_FILTER_OPTIONS: Array<RewardTier | "ALL"> = [
  "ALL",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
];

// ─── Confirm Modal ────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  reward: Reward;
  userPoints: number;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  reward,
  userPoints,
  isLoading,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const tierConfig = TIER_CONFIG[reward.tier];
  const remaining = userPoints - reward.pointsCost;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Gift className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Confirm Redemption</h2>
              <p className="text-sm text-gray-500">Review before spending points</p>
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-4">
            <p className="font-semibold text-gray-900">{reward.name}</p>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-gray-600">Cost</span>
              <span className="flex items-center gap-1 font-bold text-primary">
                <Coins className="h-4 w-4" />
                {reward.pointsCost.toLocaleString()} pts
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-gray-600">Redeemable points</span>
              <span className="text-gray-800">{userPoints.toLocaleString()} pts</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
              <span className="text-gray-600">After redemption</span>
              <span className="font-semibold text-gray-800">
                {remaining.toLocaleString()} pts
              </span>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Your redemption will be submitted for approval. You&apos;ll be notified once it&apos;s processed.
          </p>
        </div>

        <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            Spend {reward.pointsCost.toLocaleString()} pts
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Reward Card ──────────────────────────────────────────────────────────────

interface RewardCardProps {
  reward: Reward;
  userPoints: number;
  redemption: RedemptionSummary | undefined;
  onRedeem: (reward: Reward) => void;
}

function RewardCard({ reward, userPoints, redemption, onRedeem }: RewardCardProps) {
  const tierConfig = TIER_CONFIG[reward.tier];
  const canAfford = userPoints >= reward.pointsCost;
  const isRedeemed =
    redemption?.status === "PENDING" || redemption?.status === "APPROVED";
  const isFulfilled = redemption?.status === "FULFILLED";
  const isOutOfStock = reward.inventoryCount <= 0;

  let buttonLabel = "Redeem";
  if (isRedeemed) buttonLabel = "Redeemed";
  else if (isFulfilled) buttonLabel = "Fulfilled";
  else if (isOutOfStock) buttonLabel = "Out of Stock";
  else if (!canAfford) buttonLabel = "Not Enough Points";

  const buttonDisabled = isRedeemed || isFulfilled || isOutOfStock || !canAfford;

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      {/* Image / Gradient Placeholder */}
      <div className="relative h-36 overflow-hidden">
        {reward.imageUrl ? (
          <img
            src={reward.imageUrl}
            alt={reward.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${tierConfig.gradientClass}`}
          >
            <Gift className="h-12 w-12 text-white/70" />
          </div>
        )}
        {/* Tier Badge overlay */}
        <span
          className={`absolute right-2 top-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tierConfig.badgeClass}`}
        >
          {tierConfig.label}
        </span>
      </div>

      {/* Body */}
      <CardHeader className="pb-0 pt-4">
        <h3 className="line-clamp-1 text-base font-semibold text-gray-900">
          {reward.name}
        </h3>
      </CardHeader>

      <CardContent className="flex-1 pb-0">
        {reward.description ? (
          <p className="line-clamp-2 text-sm text-gray-500">{reward.description}</p>
        ) : (
          <p className="text-sm italic text-gray-400">No description provided.</p>
        )}
      </CardContent>

      {/* Footer */}
      <CardFooter className="mt-4 flex flex-col gap-3">
        <div className="flex w-full items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-bold text-primary">
            <Coins className="h-4 w-4" />
            {reward.pointsCost.toLocaleString()} pts
          </span>
          {isOutOfStock && (
            <span className="text-xs text-gray-400">Out of stock</span>
          )}
        </div>

        <Button
          variant={isRedeemed || isFulfilled ? "outline" : "primary"}
          size="sm"
          className="w-full"
          disabled={buttonDisabled}
          onClick={() => onRedeem(reward)}
        >
          {isRedeemed && <CheckCircle className="h-4 w-4" />}
          {buttonLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RewardsPage() {
  const ent = useEntitlements();
  const [data, setData] = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<RewardTier | "ALL">("ALL");
  const [pendingReward, setPendingReward] = useState<Reward | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  const fetchRewards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rewards");
      if (!res.ok) throw new Error("Failed to load rewards");
      const json: RewardsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRewards();
  }, [fetchRewards]);

  const handleRedeemClick = (reward: Reward) => {
    setPendingReward(reward);
  };

  const handleConfirmRedeem = async () => {
    if (!pendingReward || !data) return;
    setRedeeming(true);
    try {
      const res = await fetch("/api/rewards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId: pendingReward.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Redemption failed");
        return;
      }
      // Update state: new points + add new redemption
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          userPoints: json.newPoints,
          redemptions: [json.redemption, ...prev.redemptions],
        };
      });
      setPendingReward(null);
      toast.success("Reward redeemed successfully!");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setRedeeming(false);
    }
  };

  const handleCancelRedeem = () => {
    if (redeeming) return;
    setPendingReward(null);
  };

  // Rewards are a premium feature — gate for plans without the entitlement.
  if (!ent.loading && !ent.rewards) {
    return <UpgradeNotice feature="Rewards" planName={ent.planName} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Gift className="h-12 w-12 text-gray-300" />
        <p className="text-gray-500">{error || "Failed to load rewards"}</p>
        <Button variant="outline" onClick={fetchRewards}>
          Try Again
        </Button>
      </div>
    );
  }

  const { rewards, userPoints, totalPoints, qualityThreshold, redemptions } = data;
  const qualityPct = qualityThreshold ?? 60;

  const filteredRewards =
    activeFilter === "ALL"
      ? rewards
      : rewards.filter((r) => r.tier === activeFilter);

  // Map rewardId -> latest active redemption for quick lookup
  const redemptionByRewardId = new Map<string, RedemptionSummary>();
  for (const r of redemptions) {
    if (!redemptionByRewardId.has(r.rewardId)) {
      redemptionByRewardId.set(r.rewardId, r);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rewards Store</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Redeemable points are earned from quizzes you score {qualityPct}% or higher.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5">
            <Coins className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-gray-600">Redeemable</span>
            <span className="text-lg font-bold text-primary">
              {userPoints.toLocaleString()}
            </span>
            <span className="text-sm font-medium text-gray-600">pts</span>
          </div>
          {typeof totalPoints === "number" && (
            <span className="text-xs text-gray-400">
              {totalPoints.toLocaleString()} total points earned
            </span>
          )}
        </div>
      </div>

      {/* Tier Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {TIER_FILTER_OPTIONS.map((tier) => {
          const isActive = activeFilter === tier;
          const tierConf = tier !== "ALL" ? TIER_CONFIG[tier] : null;
          return (
            <button
              key={tier}
              onClick={() => setActiveFilter(tier)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tier === "ALL" ? "All" : tierConf?.label ?? tier}
            </button>
          );
        })}
      </div>

      {/* Rewards Grid */}
      {filteredRewards.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Gift className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <p className="font-semibold text-gray-600">No rewards available yet.</p>
            <p className="mt-1 text-sm text-gray-400">
              {activeFilter !== "ALL"
                ? `No ${TIER_CONFIG[activeFilter].label} rewards available. Try a different tier.`
                : "Check back soon — new rewards will be added by your school administrator."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {filteredRewards.map((reward) => (
            <RewardCard
              key={reward.id}
              reward={reward}
              userPoints={userPoints}
              redemption={redemptionByRewardId.get(reward.id)}
              onRedeem={handleRedeemClick}
            />
          ))}
        </div>
      )}

      {/* Redemption History */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Redemption History
        </h2>
        {redemptions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Award className="mx-auto mb-2 h-10 w-10 text-gray-200" />
              <p className="text-gray-500">No redemptions yet</p>
              <p className="mt-1 text-sm text-gray-400">
                Redeem a reward above to see your history here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {redemptions.map((redemption) => {
              const reward = rewards.find((r) => r.id === redemption.rewardId);
              const statusConf = REDEMPTION_STATUS_CONFIG[redemption.status];
              return (
                <Card key={redemption.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
                        <Gift className="h-4 w-4 text-gray-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {reward?.name ?? "Unknown Reward"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(redemption.createdAt).toLocaleDateString(
                            "en-US",
                            { year: "numeric", month: "short", day: "numeric" }
                          )}
                          {reward && (
                            <span className="ml-1 text-primary">
                              · {reward.pointsCost.toLocaleString()} pts
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConf.className}`}
                    >
                      {statusConf.icon}
                      {statusConf.label}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      {pendingReward && (
        <ConfirmModal
          reward={pendingReward}
          userPoints={userPoints}
          isLoading={redeeming}
          onConfirm={handleConfirmRedeem}
          onCancel={handleCancelRedeem}
        />
      )}

    </div>
  );
}
