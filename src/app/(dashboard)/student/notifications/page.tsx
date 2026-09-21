"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
}

const TYPE_ICONS: Record<string, string> = {
  homework: "📝",
  achievement: "🏆",
  level_up: "⬆️",
  streak: "🔥",
  reward: "🎁",
  battle_invite: "⚔️",
  system: "📢",
};

const FILTER_TABS = [
  { key: "all",           label: "All"          },
  { key: "unread",        label: "Unread"       },
  { key: "achievement",   label: "Achievements" },
  { key: "streak",        label: "Streaks"      },
  { key: "homework",      label: "Work set"     },
  { key: "battle_invite", label: "Battles"      },
] as const;

type FilterKey = (typeof FILTER_TABS)[number]["key"];

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [markingAll, setMarkingAll] = useState(false);
  const router = useRouter();

  /**
   * Where a notification takes you, or null if it is purely informational.
   *
   * Work a teacher set is the one kind a student must be able to act on, and
   * a notice they cannot open is worse than no notice at all — it says
   * something is due and then refuses to say what.
   */
  function destinationFor(n: NotificationItem): string | null {
    if (n.type !== "homework") return null;
    const activityId = n.data?.activityId;
    return typeof activityId === "string" && activityId
      ? `/student/activities?activity=${encodeURIComponent(activityId)}`
      : "/student/activities";
  }

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=50");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markOneRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds: [id] }),
      });
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Failed to mark notifications as read.");
    } finally {
      setMarkingAll(false);
    }
  };

  const filtered = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.isRead;
    return n.type === filter;
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-text-primary">Notifications</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={markAllRead}
            isLoading={markingAll}
            className="gap-1.5 text-xs"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-background p-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              filter === tab.key
                ? "bg-surface text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Bell className="h-10 w-10 text-text-muted" />
              <p className="text-sm text-text-secondary">
                {filter === "unread" ? "All caught up!" : "No notifications yet."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.isRead) markOneRead(n.id);
                    const to = destinationFor(n);
                    if (to) router.push(to);
                  }}
                  className={cn(
                    "flex w-full items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-surface/60",
                    !n.isRead && "bg-primary/5"
                  )}
                >
                  {/* Unread indicator */}
                  <div className="relative shrink-0 mt-0.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-xl">
                      {TYPE_ICONS[n.type] ?? "📢"}
                    </div>
                    {!n.isRead && (
                      <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.isRead ? "font-semibold text-text-primary" : "font-medium text-text-primary")}>
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">{n.message}</p>
                  </div>

                  <span className="shrink-0 text-xs text-text-muted mt-0.5">
                    {timeAgo(n.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
