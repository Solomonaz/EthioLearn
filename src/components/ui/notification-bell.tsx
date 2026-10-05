"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  /** Computed to-do (e.g. a textbook request to review): unread until handled. */
  actionable?: boolean;
  data?: { href?: string } | null;
}

const typeIcons: Record<string, string> = {
  achievement: "\u{1F3C6}",
  level_up: "\u2B06\uFE0F",
  streak: "\u{1F525}",
  reward: "\u{1F381}",
  battle_invite: "\u2694\uFE0F",
  system: "\u{1F4E2}",
  textbook_request: "\u{1F4DA}",
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * `viewAllHref`: the full notifications page, linked from the dropdown's
 * footer. The bell is the only way in — the page is not in the side menu.
 */
export function NotificationBell({ viewAllHref }: { viewAllHref?: string } = {}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const markAsRead = async (notificationIds: string[]) => {
    if (notificationIds.length === 0) return;
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds }),
      });
      setNotifications((prev) =>
        prev.map((n) =>
          notificationIds.includes(n.id) ? { ...n, isRead: true } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - notificationIds.length));
    } catch {
      // silently fail
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      // Action items aren't "read" — they clear once the request is handled.
      setNotifications((prev) => prev.map((n) => (n.actionable ? n : { ...n, isRead: true })));
      setUnreadCount(notifications.filter((n) => n.actionable).length);
    } catch {
      // silently fail
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-lg p-2 text-text-secondary hover:bg-gray-100"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text-primary">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs font-medium text-primary hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-text-secondary">
                No notifications yet
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => {
                    if (!notification.isRead && !notification.actionable) {
                      markAsRead([notification.id]);
                    }
                    const href = notification.data?.href;
                    if (href) {
                      setIsOpen(false);
                      router.push(href);
                    }
                  }}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50",
                    !notification.isRead && "bg-primary/5"
                  )}
                >
                  <span className="mt-0.5 text-lg">
                    {typeIcons[notification.type] || "\u{1F4E2}"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          "text-sm",
                          !notification.isRead
                            ? "font-semibold text-text-primary"
                            : "font-medium text-text-secondary"
                        )}
                      >
                        {notification.title}
                      </p>
                      {!notification.isRead && (
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary line-clamp-2">
                      {notification.message}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-[10px] text-text-secondary/70">
                      {timeAgo(notification.createdAt)}
                      {notification.actionable && (
                        <span className="rounded-full bg-warning/15 px-1.5 py-px font-semibold text-warning">
                          Needs review
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
          {viewAllHref && (
            <button
              onClick={() => {
                setIsOpen(false);
                router.push(viewAllHref);
              }}
              className="block w-full border-t border-border px-4 py-2.5 text-center text-xs font-medium text-primary hover:bg-gray-50"
            >
              View all notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}
