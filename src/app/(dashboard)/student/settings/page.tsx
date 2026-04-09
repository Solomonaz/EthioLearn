"use client";

import { useEffect, useState, useTransition, Suspense } from "react";
import {
  User,
  Phone,
  Calendar,
  Star,
  Shield,
  LogOut,
  Moon,
  Monitor,
  Smartphone,
  Globe,
  Trash2,
  RefreshCw,
  Link2,
  Unlink,
  CheckCircle2,
} from "lucide-react";
import dynamic from "next/dynamic";

const TelegramLinkButton = dynamic(
  () => import("@/components/auth/telegram-link-button").then((m) => m.TelegramLinkButton),
  { ssr: false, loading: () => <div className="h-10" /> },
);
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { signOut, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { cn, formatDate } from "@/lib/utils";
import { AVATAR_PRESETS } from "@/lib/avatar-presets";

// ── Types ────────────────────────────────────────────────────────────────────

interface UserSettings {
  id: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  grade: number | null;
  section: string | null;
  avatarUrl: string | null;
  totalPoints: number;
  xpLevel: number;
  createdAt: string;
  telegramLinked: boolean;
}

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
const TELEGRAM_ENABLED = TELEGRAM_BOT_USERNAME.length > 0;

interface ActiveSession {
  id: string;
  sessionId: string;
  deviceName: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

const GRADES = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: `Grade ${i + 1}`,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function DeviceIcon({ deviceName }: { deviceName: string | null }) {
  const name = (deviceName ?? "").toLowerCase();
  if (name.includes("android") || name.includes("ios") || name.includes("iphone")) {
    return <Smartphone className="h-4 w-4 text-text-secondary" />;
  }
  return <Monitor className="h-4 w-4 text-text-secondary" />;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

function StudentSettingsInner() {
  const { data: session } = useSession();
  const currentSessionId = (session as typeof session & { sessionId?: string })
    ?.sessionId;
  const searchParams = useSearchParams();

  const [userData, setUserData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [grade, setGrade]       = useState<number | "">("");
  const [section, setSection]   = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving]     = useState(false);

  // Language toggle
  const [isPending, startTransition] = useTransition();

  // Dark mode placeholder
  const [darkMode, setDarkMode] = useState(false);

  // Telegram link state
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);

  // Sessions state
  const [sessions, setSessions]           = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingId, setRevokingId]       = useState<string | null>(null);
  const [revokingAll, setRevokingAll]     = useState(false);

  // ── Handle Telegram link callback ───────────────────────────────────────
  useEffect(() => {
    const linked    = searchParams.get("tg_linked");
    const linkError = searchParams.get("tg_link_error");
    if (linked === "true") {
      setTelegramLinked(true);
      toast.success("Telegram account linked!");
      // Clean the URL
      window.history.replaceState({}, "", "/student/settings");
    } else if (linkError) {
      const msg = linkError === "network"
        ? "Network error linking Telegram. Please try again."
        : decodeURIComponent(linkError);
      toast.error(msg);
      window.history.replaceState({}, "", "/student/settings");
    }
  }, [searchParams]);

  // ── Fetch profile ────────────────────────────────────────────────────────

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch("/api/students/me/settings");
        if (!res.ok) throw new Error("Failed to load settings");
        const data = await res.json();
        const user: UserSettings = data.user;
        setUserData(user);
        setName(user.name);
        setEmail(user.email || "");
        setGrade(user.grade ?? "");
        setSection(user.section || "");
        setAvatarUrl(user.avatarUrl || "");
        setTelegramLinked(user.telegramLinked);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  // ── Fetch sessions ───────────────────────────────────────────────────────

  const fetchSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/auth/sessions");
      if (!res.ok) throw new Error("Failed to load sessions");
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      toast.error("Could not load active sessions");
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // ── Save profile ─────────────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const body: Record<string, unknown> = {
        name:      name.trim(),
        email:     email.trim() || "",
        section:   section.trim(),
        avatarUrl: avatarUrl.trim(),
      };
      if (grade !== "") body.grade = Number(grade);

      const res = await fetch("/api/students/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save");
        return;
      }

      setUserData(data.user);
      toast.success("Settings saved successfully!");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  // ── Session actions ──────────────────────────────────────────────────────

  const handleRevokeSession = async (sessionDbId: string) => {
    setRevokingId(sessionDbId);
    try {
      const res = await fetch(`/api/auth/sessions/${sessionDbId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setSessions((prev) => prev.filter((s) => s.id !== sessionDbId));
      toast.success("Session revoked");
    } catch {
      toast.error("Failed to revoke session");
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAll = async () => {
    setRevokingAll(true);
    try {
      const res = await fetch("/api/auth/sessions", { method: "DELETE" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSessions((prev) => prev.filter((s) => s.isCurrent));
      toast.success(
        `Signed out of ${data.revokedCount} other session${data.revokedCount !== 1 ? "s" : ""}`
      );
    } catch {
      toast.error("Failed to revoke sessions");
    } finally {
      setRevokingAll(false);
    }
  };

  // ── Telegram unlink ──────────────────────────────────────────────────────

  const handleTelegramUnlink = async () => {
    setTelegramLoading(true);
    try {
      const res = await fetch("/api/students/me/link-telegram", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Failed to unlink Telegram");
        return;
      }
      setTelegramLinked(false);

      if (data.requireSignOut) {
        // Telegram was the only login method — sign the user out and send
        // them to /register so they start fresh (not /login which would just
        // show a "no account found" error if they try Telegram again).
        toast.success("Telegram unlinked. Please register again to continue.");
        await signOut({ callbackUrl: "/register" });
      } else {
        toast.success("Telegram account unlinked");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setTelegramLoading(false);
    }
  };

  // ── Language ─────────────────────────────────────────────────────────────

  const switchLocale = (locale: "en" | "am") => {
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        body: JSON.stringify({ locale }),
      });
      window.location.reload();
    });
  };

  // ── Render guards ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (error || !userData) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{error ?? "Failed to load settings"}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage your profile and preferences
        </p>
      </div>

      {/* ── Profile ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Profile</h2>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            {/* Avatar preview */}
            <div className="flex flex-col items-center gap-3">
              <Avatar
                name={name || userData.name}
                src={avatarUrl || null}
                size="lg"
                className="h-20 w-20 text-2xl"
              />
            </div>

            {/* Avatar picker */}
            <div>
              <p className="mb-2 text-sm font-medium text-text-primary">Avatar</p>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                {AVATAR_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setAvatarUrl(`preset:${preset.id}`)}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full text-xl transition-all",
                      preset.bg,
                      avatarUrl === `preset:${preset.id}`
                        ? "ring-2 ring-primary ring-offset-2 scale-110"
                        : "opacity-70 hover:opacity-100 hover:scale-105"
                    )}
                    title={preset.emoji}
                  >
                    {preset.emoji}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Name"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={50}
            />

            <Input
              label="Email"
              type="email"
              placeholder="your@email.com (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <div className="w-full">
              <label
                htmlFor="grade"
                className="mb-2 block text-sm font-medium text-text-primary"
              >
                Grade
              </label>
              <select
                id="grade"
                value={grade}
                onChange={(e) =>
                  setGrade(e.target.value ? Number(e.target.value) : "")
                }
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select grade</option>
                {GRADES.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Section"
              placeholder='e.g. "A", "B"'
              value={section}
              onChange={(e) => setSection(e.target.value)}
            />

            <Button type="submit" isLoading={saving} className="w-full">
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Account Info ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">
              Account Info
            </h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <InfoRow
              icon={<Phone className="h-4 w-4 text-text-secondary" />}
              label="Phone Number"
              value={userData.phoneNumber}
            />
            <InfoRow
              icon={<Calendar className="h-4 w-4 text-text-secondary" />}
              label="Member Since"
              value={formatDate(userData.createdAt, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            />
            <InfoRow
              icon={<Star className="h-4 w-4 text-text-secondary" />}
              label="Total Points"
              value={userData.totalPoints.toLocaleString()}
            />
            <InfoRow
              icon={<Shield className="h-4 w-4 text-text-secondary" />}
              label="XP Level"
              value={`Level ${userData.xpLevel}`}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Connected Accounts ────────────────────────────────────────────── */}
      {TELEGRAM_ENABLED && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">
                Connected Accounts
              </h2>
            </div>
            <p className="text-xs text-text-secondary">
              Link social accounts to sign in faster.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="flex items-center gap-3">
                {/* Telegram logo */}
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#229ED9]/10">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5 fill-[#229ED9]"
                    aria-hidden="true"
                  >
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.96 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">Telegram</p>
                  <p className="text-xs text-text-secondary">
                    {telegramLinked ? "Account linked" : "Not connected"}
                  </p>
                </div>
                {telegramLinked && (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
              </div>

              <div className="flex-shrink-0">
                {telegramLinked ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-200 text-error hover:bg-red-50"
                    onClick={handleTelegramUnlink}
                    isLoading={telegramLoading}
                  >
                    <Unlink className="mr-1.5 h-3.5 w-3.5" />
                    Unlink
                  </Button>
                ) : telegramLoading ? (
                  <div className="flex h-10 items-center px-2 text-sm text-text-secondary">
                    Linking…
                  </div>
                ) : (
                  <TelegramLinkButton
                    botUsername={TELEGRAM_BOT_USERNAME}
                  />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Active Sessions (§4.1.2) ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">
                Active Sessions
              </h2>
              <Badge variant="default" className="text-xs">
                {sessions.length}
              </Badge>
            </div>
            <button
              onClick={fetchSessions}
              disabled={sessionsLoading}
              className="rounded-md p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              title="Refresh sessions"
            >
              <RefreshCw
                className={cn("h-4 w-4", sessionsLoading && "animate-spin")}
              />
            </button>
          </div>
          <p className="text-xs text-text-secondary">
            These are the devices currently signed into your account.
          </p>
        </CardHeader>
        <CardContent>
          {sessionsLoading && sessions.length === 0 ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" className="text-primary" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-text-secondary">No active sessions found.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-center justify-between rounded-lg border p-3",
                    s.isCurrent
                      ? "border-primary/30 bg-primary/5"
                      : "border-border bg-surface"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <DeviceIcon deviceName={s.deviceName} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">
                          {s.deviceName ?? "Unknown Device"}
                        </span>
                        {s.isCurrent && (
                          <Badge
                            variant="default"
                            className="bg-primary/10 text-xs text-primary"
                          >
                            This device
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
                        {s.ipAddress && <span>{s.ipAddress}</span>}
                        <span>Last active {timeAgo(s.lastUsedAt)}</span>
                        <span>
                          Signed in{" "}
                          {formatDate(s.createdAt, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {!s.isCurrent && (
                    <button
                      onClick={() => handleRevokeSession(s.id)}
                      disabled={revokingId === s.id}
                      className="ml-2 flex-shrink-0 rounded-md p-1.5 text-text-secondary transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Revoke this session"
                    >
                      {revokingId === s.id ? (
                        <Spinner size="sm" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              ))}

              {otherSessions.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full border-red-200 text-error hover:bg-red-50"
                  onClick={handleRevokeAll}
                  isLoading={revokingAll}
                >
                  <LogOut className="mr-1.5 h-4 w-4" />
                  Sign out of all other sessions ({otherSessions.length})
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Preferences ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-text-primary">
            Preferences
          </h2>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Language */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">Language</p>
                <p className="text-xs text-text-secondary">
                  Switch between English and Amharic
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                <button
                  onClick={() => switchLocale("en")}
                  disabled={isPending}
                  className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-primary/10"
                >
                  EN
                </button>
                <button
                  onClick={() => switchLocale("am")}
                  disabled={isPending}
                  className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-primary/10"
                >
                  {"\u12A0\u121B"}
                </button>
              </div>
            </div>

            {/* Dark mode (placeholder) */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">
                    Dark Mode
                  </p>
                  <Badge variant="default">Coming Soon</Badge>
                </div>
                <p className="text-xs text-text-secondary">Toggle dark theme</p>
              </div>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  darkMode ? "bg-primary" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white transition-transform ${
                    darkMode ? "translate-x-5" : "translate-x-0"
                  }`}
                >
                  <Moon className="h-3 w-3 text-text-secondary" />
                </span>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Danger Zone ───────────────────────────────────────────────────── */}
      <Card className="border-red-200">
        <CardHeader>
          <h2 className="text-lg font-semibold text-error">Danger Zone</h2>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">Sign Out</p>
              <p className="text-xs text-text-secondary">
                Sign out of your account on this device
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-red-200 text-error hover:bg-red-50"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              <LogOut className="mr-1 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// useSearchParams requires a Suspense boundary in the page tree
export default function StudentSettingsPage() {
  return (
    <Suspense fallback={<div />}>
      <StudentSettingsInner />
    </Suspense>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-text-secondary">{label}</span>
      </div>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}
