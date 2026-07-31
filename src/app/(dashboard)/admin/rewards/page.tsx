"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/sonner";
import { formatDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type RewardTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";
type RedemptionStatus = "PENDING" | "APPROVED" | "DENIED" | "FULFILLED";
type RedemptionWindow = "ANYTIME" | "MONTHLY" | "QUARTERLY" | "SEMESTER";

interface Reward {
  id: string;
  name: string;
  description: string | null;
  tier: RewardTier;
  pointsCost: number;
  inventoryCount: number;
  imageUrl: string | null;
  redemptionWindow?: RedemptionWindow;
  windowStartDate?: string | null;
  windowEndDate?: string | null;
  maxRedemptionsPerWindow?: number | null;
  createdAt: string;
  _count: { redemptions: number };
}

interface Redemption {
  id: string;
  status: RedemptionStatus;
  createdAt: string;
  student: {
    id: string;
    name: string;
    phoneNumber: string;
    grade: number | null;
    totalPoints: number;
  };
  reward: {
    id: string;
    name: string;
    tier: RewardTier;
    pointsCost: number;
  };
  approvedBy: { name: string } | null;
}

interface Budget {
  id: string;
  name: string;
  totalBudget: number;
  spent: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tierBadgeClass(tier: RewardTier): string {
  const map: Record<RewardTier, string> = {
    BRONZE: "bg-amber-100 text-amber-700",
    SILVER: "bg-gray-100 text-gray-600",
    GOLD: "bg-yellow-100 text-yellow-700",
    PLATINUM: "bg-purple-100 text-purple-700",
  };
  return map[tier];
}

function statusBadgeVariant(status: RedemptionStatus): "warning" | "success" | "error" | "info" {
  const map: Record<RedemptionStatus, "warning" | "success" | "error" | "info"> = {
    PENDING: "warning",
    APPROVED: "success",
    DENIED: "error",
    FULFILLED: "info",
  };
  return map[status];
}


// ─── Reward Form ──────────────────────────────────────────────────────────────

interface RewardFormProps {
  initial?: Reward | null;
  onSuccess: () => void;
  onCancel: () => void;
}

function RewardForm({ initial, onSuccess, onCancel }: RewardFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tier, setTier] = useState<RewardTier>(initial?.tier ?? "BRONZE");
  const [pointsCost, setPointsCost] = useState(String(initial?.pointsCost ?? ""));
  const [inventoryCount, setInventoryCount] = useState(String(initial?.inventoryCount ?? "10"));
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [redemptionWindow, setRedemptionWindow] = useState<RedemptionWindow>(
    initial?.redemptionWindow ?? "ANYTIME"
  );
  const [windowStartDate, setWindowStartDate] = useState(initial?.windowStartDate ?? "");
  const [windowEndDate, setWindowEndDate] = useState(initial?.windowEndDate ?? "");
  const [maxRedemptionsPerWindow, setMaxRedemptionsPerWindow] = useState(
    initial?.maxRedemptionsPerWindow != null ? String(initial.maxRedemptionsPerWindow) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Name is required.");
    if (!description.trim()) return setError("Description is required.");
    if (!pointsCost || isNaN(Number(pointsCost)) || Number(pointsCost) < 0)
      return setError("Valid points cost is required.");
    if (!inventoryCount || isNaN(Number(inventoryCount)) || Number(inventoryCount) < 0)
      return setError("Valid inventory count is required.");
    if (redemptionWindow === "SEMESTER") {
      if (!windowStartDate) return setError("Window start date is required for SEMESTER window.");
      if (!windowEndDate) return setError("Window end date is required for SEMESTER window.");
      if (new Date(windowStartDate) >= new Date(windowEndDate))
        return setError("Window start date must be before end date.");
    }

    setLoading(true);

    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim(),
      tier,
      pointsCost: Number(pointsCost),
      inventoryCount: Number(inventoryCount),
      imageUrl: imageUrl.trim() || undefined,
      redemptionWindow,
      windowStartDate: redemptionWindow === "SEMESTER" ? windowStartDate : null,
      windowEndDate: redemptionWindow === "SEMESTER" ? windowEndDate : null,
      maxRedemptionsPerWindow: maxRedemptionsPerWindow
        ? Number(maxRedemptionsPerWindow)
        : null,
    };

    try {
      const res = await fetch(
        initial ? `/api/admin/rewards/${initial.id}` : "/api/admin/rewards",
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save reward.");
        return;
      }

      onSuccess();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mb-6 border-primary/20">
      <CardHeader>
        <h2 className="text-lg font-semibold text-text-primary">
          {initial ? "Edit Reward" : "Add New Reward"}
        </h2>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-error">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. School Pen Set"
            />

            <div className="w-full">
              <label className="mb-2 block text-sm font-medium text-text-primary">Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as RewardTier)}
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="BRONZE">Bronze</option>
                <option value="SILVER">Silver</option>
                <option value="GOLD">Gold</option>
                <option value="PLATINUM">Platinum</option>
              </select>
            </div>
          </div>

          <div className="w-full">
            <label className="mb-2 block text-sm font-medium text-text-primary">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe this reward..."
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Points Cost"
              type="number"
              min={0}
              value={pointsCost}
              onChange={(e) => setPointsCost(e.target.value)}
              placeholder="e.g. 500"
            />

            <Input
              label="Inventory Count"
              type="number"
              min={0}
              value={inventoryCount}
              onChange={(e) => setInventoryCount(e.target.value)}
              placeholder="e.g. 10"
            />
          </div>

          <Input
            label="Image URL (optional)"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.png"
          />

          {/* Redemption Window fields */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="w-full">
              <label className="mb-2 block text-sm font-medium text-text-primary">
                Redemption Window
              </label>
              <select
                value={redemptionWindow}
                onChange={(e) => setRedemptionWindow(e.target.value as RedemptionWindow)}
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="ANYTIME">Anytime</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="SEMESTER">Semester</option>
              </select>
            </div>

            <Input
              label="Max Redemptions Per Window (optional)"
              type="number"
              min={1}
              value={maxRedemptionsPerWindow}
              onChange={(e) => setMaxRedemptionsPerWindow(e.target.value)}
              placeholder="e.g. 5"
            />
          </div>

          {redemptionWindow === "SEMESTER" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Window Start Date"
                type="date"
                value={windowStartDate}
                onChange={(e) => setWindowStartDate(e.target.value)}
              />
              <Input
                label="Window End Date"
                type="date"
                value={windowEndDate}
                onChange={(e) => setWindowEndDate(e.target.value)}
              />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" isLoading={loading}>
              {initial ? "Save Changes" : "Create Reward"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Reward Card ──────────────────────────────────────────────────────────────

interface RewardCardProps {
  reward: Reward;
  onEdit: (reward: Reward) => void;
  onDelete: (reward: Reward) => void;
}

function RewardCard({ reward, onEdit, onDelete }: RewardCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/rewards/${reward.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error ?? "Failed to delete reward.");
        setConfirmDelete(false);
        return;
      }
      onDelete(reward);
    } catch {
      setDeleteError("Network error. Please try again.");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      {reward.imageUrl && (
        <div className="h-36 w-full overflow-hidden bg-gray-100">
          <img
            src={reward.imageUrl}
            alt={reward.name}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tierBadgeClass(reward.tier)}`}
          >
            {reward.tier}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => onEdit(reward)}
              className="rounded p-1.5 text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
              title="Edit reward"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={() => {
                setConfirmDelete(true);
                setDeleteError(null);
              }}
              className="rounded p-1.5 text-text-secondary transition-colors hover:bg-red-50 hover:text-error"
              title="Delete reward"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-text-primary">{reward.name}</h3>
          {reward.description && (
            <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{reward.description}</p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between pt-2 text-sm">
          <div className="flex items-center gap-1 font-medium text-primary">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <circle cx="12" cy="12" r="10" />
              <path
                fill="white"
                d="M12 6v6l4 2"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            {reward.pointsCost.toLocaleString()} pts
          </div>
          <div className="text-text-secondary">
            Stock: <span className="font-medium text-text-primary">{reward.inventoryCount}</span>
          </div>
          <div className="text-text-secondary">
            Redeemed:{" "}
            <span className="font-medium text-text-primary">{reward._count.redemptions}</span>
          </div>
        </div>

        {deleteError && (
          <p className="rounded bg-red-50 px-3 py-2 text-xs text-error">{deleteError}</p>
        )}

        {confirmDelete && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="mb-3 text-sm font-medium text-error">
              Delete &quot;{reward.name}&quot;? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleDelete}
                isLoading={deleting}
                className="bg-error hover:bg-red-700 focus:ring-red-300"
              >
                Delete
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Rewards Tab ──────────────────────────────────────────────────────────────

interface RewardsTabProps {
  rewards: Reward[];
  loading: boolean;
  onRefresh: () => void;
}

function RewardsTab({ rewards, loading, onRefresh }: RewardsTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [localRewards, setLocalRewards] = useState<Reward[]>(rewards);

  useEffect(() => {
    setLocalRewards(rewards);
  }, [rewards]);

  function handleEdit(reward: Reward) {
    setEditingReward(reward);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleDelete(deleted: Reward) {
    setLocalRewards((prev) => prev.filter((r) => r.id !== deleted.id));
    toast.success(`"${deleted.name}" deleted.`);
    onRefresh();
  }

  function handleFormSuccess() {
    setShowForm(false);
    setEditingReward(null);
    toast.success(editingReward ? "Reward updated." : "Reward created.");
    onRefresh();
  }

  function handleFormCancel() {
    setShowForm(false);
    setEditingReward(null);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">Manage Rewards</h2>
        {!showForm && (
          <Button
            onClick={() => {
              setEditingReward(null);
              setShowForm(true);
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Reward
          </Button>
        )}
      </div>

      {showForm && (
        <RewardForm
          initial={editingReward}
          onSuccess={handleFormSuccess}
          onCancel={handleFormCancel}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : localRewards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
          <div className="mb-3 text-4xl">🎁</div>
          <p className="font-semibold text-text-primary">No rewards yet</p>
          <p className="mt-1 text-sm text-text-secondary">
            Click &quot;Add Reward&quot; to create your first reward.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {localRewards.map((reward) => (
            <RewardCard
              key={reward.id}
              reward={reward}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Redemptions Tab ──────────────────────────────────────────────────────────

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Denied", value: "DENIED" },
  { label: "Fulfilled", value: "FULFILLED" },
];

interface RedemptionsTabProps {
  pendingCount: number;
}

function RedemptionsTab({ pendingCount }: RedemptionsTabProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchRedemptions = useCallback(
    async (currentPage: number, status: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          status,
          page: String(currentPage),
          limit: "20",
        });
        const res = await fetch(`/api/admin/redemptions?${params}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Failed to load redemptions.");
          return;
        }
        const data = await res.json();
        setRedemptions(data.redemptions ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchRedemptions(page, statusFilter);
  }, [page, statusFilter, fetchRedemptions]);

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  async function handleAction(redemptionId: string, action: "approve" | "deny" | "fulfill") {
    setActionLoading(redemptionId + action);
    try {
      const res = await fetch(`/api/admin/redemptions/${redemptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Action failed.");
        return;
      }
      const data = await res.json();
      setRedemptions((prev) =>
        prev.map((r) => (r.id === redemptionId ? data.redemption : r))
      );
      const actionLabel = action === "approve" ? "Approved" : action === "deny" ? "Denied" : "Fulfilled";
      toast.success(`Redemption ${actionLabel.toLowerCase()} successfully.`);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">Redemption Requests</h2>
        {total > 0 && (
          <span className="text-sm text-text-secondary">
            {total} total
          </span>
        )}
      </div>

      {/* Status filter pills */}
      <div className="mb-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const isActive = statusFilter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => handleFilterChange(f.value)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-text-secondary hover:bg-gray-200"
              }`}
            >
              {f.label}
              {f.value === "PENDING" && pendingCount > 0 && (
                <span
                  className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs font-bold ${
                    isActive ? "bg-white text-primary" : "bg-warning text-white"
                  }`}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-error">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : redemptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
          <div className="mb-3 text-4xl">
            {statusFilter === "PENDING" ? "⏳" : statusFilter === "APPROVED" ? "✅" : statusFilter === "DENIED" ? "❌" : statusFilter === "FULFILLED" ? "📦" : "🎁"}
          </div>
          <p className="font-semibold text-text-primary">
            No {statusFilter === "all" ? "" : statusFilter.toLowerCase()} redemptions
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {statusFilter === "PENDING"
              ? "No pending requests at this time."
              : "Nothing to show here yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-gray-50 text-left">
                  <th className="px-4 py-3 font-semibold text-text-secondary">Student</th>
                  <th className="px-4 py-3 font-semibold text-text-secondary">Reward</th>
                  <th className="px-4 py-3 font-semibold text-text-secondary">Points</th>
                  <th className="px-4 py-3 font-semibold text-text-secondary">Requested</th>
                  <th className="px-4 py-3 font-semibold text-text-secondary">Status</th>
                  <th className="px-4 py-3 font-semibold text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {redemptions.map((redemption) => {
                  const isActing = actionLoading?.startsWith(redemption.id);
                  return (
                    <tr key={redemption.id} className="bg-white transition-colors hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary">{redemption.student.name}</div>
                        <div className="text-xs text-text-secondary">
                          {redemption.student.grade ? `Grade ${redemption.student.grade}` : "—"}
                          {" · "}
                          {redemption.student.phoneNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary">{redemption.reward.name}</div>
                        <span
                          className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tierBadgeClass(redemption.reward.tier)}`}
                        >
                          {redemption.reward.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-primary">
                          {redemption.reward.pointsCost.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {formatDate(redemption.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusBadgeVariant(redemption.status)}>
                          {redemption.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {redemption.status === "PENDING" && (
                            <>
                              <button
                                onClick={() => handleAction(redemption.id, "approve")}
                                disabled={!!isActing}
                                className="inline-flex items-center gap-1 rounded-lg bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700 transition-colors hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {actionLoading === redemption.id + "approve" ? (
                                  <Spinner size="sm" />
                                ) : null}
                                Approve
                              </button>
                              <button
                                onClick={() => handleAction(redemption.id, "deny")}
                                disabled={!!isActing}
                                className="inline-flex items-center gap-1 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {actionLoading === redemption.id + "deny" ? (
                                  <Spinner size="sm" />
                                ) : null}
                                Deny
                              </button>
                            </>
                          )}
                          {redemption.status === "APPROVED" && (
                            <button
                              onClick={() => handleAction(redemption.id, "fulfill")}
                              disabled={!!isActing}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {actionLoading === redemption.id + "fulfill" ? (
                                <Spinner size="sm" />
                              ) : null}
                              Mark Fulfilled
                            </button>
                          )}
                          {(redemption.status === "DENIED" || redemption.status === "FULFILLED") && (
                            <span className="text-xs text-text-muted">
                              {redemption.approvedBy ? `by ${redemption.approvedBy.name}` : "—"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-text-secondary">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Budget Tab ───────────────────────────────────────────────────────────────

function BudgetTab() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formTotal, setFormTotal] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchBudgets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rewards/budgets");
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to load budgets.");
        return;
      }
      const data = await res.json();
      setBudgets(data.budgets ?? []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);

  function openCreateForm() {
    setEditingBudget(null);
    setFormName("");
    setFormTotal("");
    setFormStart("");
    setFormEnd("");
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(budget: Budget) {
    setEditingBudget(budget);
    setFormName(budget.name);
    setFormTotal(String(budget.totalBudget));
    setFormStart(budget.periodStart.slice(0, 10));
    setFormEnd(budget.periodEnd.slice(0, 10));
    setFormError(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleFormCancel() {
    setShowForm(false);
    setEditingBudget(null);
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) return setFormError("Name is required.");
    if (!formTotal || isNaN(Number(formTotal)) || Number(formTotal) <= 0)
      return setFormError("Valid total budget is required.");
    if (!formStart) return setFormError("Period start date is required.");
    if (!formEnd) return setFormError("Period end date is required.");
    if (new Date(formStart) >= new Date(formEnd))
      return setFormError("Start date must be before end date.");

    setFormLoading(true);

    const body = {
      name: formName.trim(),
      totalBudget: Number(formTotal),
      periodStart: formStart,
      periodEnd: formEnd,
    };

    try {
      const url = editingBudget
        ? `/api/admin/rewards/budgets/${editingBudget.id}`
        : "/api/admin/rewards/budgets";
      const res = await fetch(url, {
        method: editingBudget ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error ?? "Failed to save budget.");
        return;
      }

      toast.success(editingBudget ? "Budget updated." : "Budget created.");
      setShowForm(false);
      setEditingBudget(null);
      fetchBudgets();
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(budget: Budget) {
    setDeletingId(budget.id);
    try {
      const res = await fetch(`/api/admin/rewards/budgets/${budget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to delete budget.");
        return;
      }
      toast.success(`"${budget.name}" deleted.`);
      fetchBudgets();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">Budget Periods</h2>
        {!showForm && (
          <Button onClick={openCreateForm}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Budget
          </Button>
        )}
      </div>

      {/* Budget Form */}
      {showForm && (
        <Card className="mb-6 border-primary/20">
          <CardHeader>
            <h2 className="text-lg font-semibold text-text-primary">
              {editingBudget ? "Edit Budget" : "Create Budget"}
            </h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-error">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Q1 2026 Budget"
                />
                <Input
                  label="Total Budget (ETB)"
                  type="number"
                  min={1}
                  value={formTotal}
                  onChange={(e) => setFormTotal(e.target.value)}
                  placeholder="e.g. 50000"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Period Start"
                  type="date"
                  value={formStart}
                  onChange={(e) => setFormStart(e.target.value)}
                />
                <Input
                  label="Period End"
                  type="date"
                  value={formEnd}
                  onChange={(e) => setFormEnd(e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" isLoading={formLoading}>
                  {editingBudget ? "Save Changes" : "Create Budget"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleFormCancel}
                  disabled={formLoading}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-error">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
          <div className="mb-3 text-4xl">💰</div>
          <p className="font-semibold text-text-primary">No budgets yet</p>
          <p className="mt-1 text-sm text-text-secondary">
            Click &quot;Create Budget&quot; to set up your first budget period.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => {
            const spentPercent =
              budget.totalBudget > 0
                ? Math.round((budget.spent / budget.totalBudget) * 100)
                : 0;
            const progressColor =
              spentPercent >= 90 ? "success" : spentPercent >= 70 ? "secondary" : "primary";

            return (
              <Card key={budget.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-text-primary">{budget.name}</h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEditForm(budget)}
                        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                        title="Edit budget"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(budget)}
                        disabled={deletingId === budget.id}
                        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-red-50 hover:text-error disabled:opacity-50"
                        title="Delete budget"
                      >
                        {deletingId === budget.id ? (
                          <Spinner size="sm" />
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <p className="text-sm text-text-secondary">
                    {formatDate(budget.periodStart)} &ndash; {formatDate(budget.periodEnd)}
                  </p>

                  <div className="mt-auto space-y-2 pt-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-secondary">
                        Spent:{" "}
                        <span className="font-medium text-text-primary">
                          {budget.spent.toLocaleString()} ETB
                        </span>
                      </span>
                      <span className="text-text-secondary">
                        Total:{" "}
                        <span className="font-medium text-text-primary">
                          {budget.totalBudget.toLocaleString()} ETB
                        </span>
                      </span>
                    </div>
                    <ProgressBar
                      value={spentPercent}
                      color={progressColor as "primary" | "secondary" | "success"}
                      size="md"
                      showLabel
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminRewardsPage() {
  const t = useTranslations("admin");
  const [activeTab, setActiveTab] = useState<"rewards" | "redemptions" | "budget">("rewards");
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const fetchRewards = useCallback(async () => {
    setRewardsLoading(true);
    try {
      const res = await fetch("/api/admin/rewards");
      if (res.ok) {
        const data = await res.json();
        setRewards(data.rewards ?? []);
      }
    } finally {
      setRewardsLoading(false);
    }
  }, []);

  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/redemptions?status=PENDING&limit=1");
      if (res.ok) {
        const data = await res.json();
        setPendingCount(data.total ?? 0);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchRewards();
    fetchPendingCount();
  }, [fetchRewards, fetchPendingCount]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-text-primary">{t("rewardsTitle")}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t("rewardsSubtitle")}
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-border">
          <div className="flex gap-0">
            <button
              onClick={() => setActiveTab("rewards")}
              className={`relative px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "rewards"
                  ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:content-['']"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {t("rewardsTitle")}
              {rewards.length > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-100 px-1 text-xs font-bold text-text-secondary">
                  {rewards.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("redemptions")}
              className={`relative px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "redemptions"
                  ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:content-['']"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {t("pendingRedemptions")}
              {pendingCount > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1 text-xs font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("budget")}
              className={`relative px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "budget"
                  ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:content-['']"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Budget
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "rewards" ? (
          <RewardsTab
            rewards={rewards}
            loading={rewardsLoading}
            onRefresh={() => {
              fetchRewards();
              fetchPendingCount();
            }}
          />
        ) : activeTab === "redemptions" ? (
          <RedemptionsTab pendingCount={pendingCount} />
        ) : (
          <BudgetTab />
        )}
      </div>
    </div>
  );
}
