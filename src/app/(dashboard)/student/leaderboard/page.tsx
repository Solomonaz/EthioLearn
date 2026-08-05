"use client";

import { useEffect, useState, useCallback } from "react";
import { Trophy, Medal, Crown, Star, ChevronDown, Users, GraduationCap, School } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SkeletonRow } from "@/components/ui/skeleton";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import { useEntitlements } from "@/hooks/use-entitlements";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  grade: number | null;
  section: string | null;
  avatarUrl: string | null;
  totalPoints: number;
  xpLevel: number;
  isCurrentUser: boolean;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  currentUserRank: number | null;
}

type ScopeType = "school" | "grade" | "class";

// ── Medal helpers ──────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-400 shadow-sm">
        <Crown className="h-4 w-4 text-white" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-300 shadow-sm">
        <Medal className="h-4 w-4 text-white" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-600 shadow-sm">
        <Medal className="h-4 w-4 text-white" />
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center">
      <span className="text-sm font-semibold text-text-secondary">#{rank}</span>
    </div>
  );
}

function rowBackground(rank: number, isCurrentUser: boolean) {
  if (isCurrentUser) return "bg-primary/5 ring-1 ring-primary/30";
  if (rank === 1) return "bg-yellow-50";
  if (rank === 2) return "bg-gray-50";
  if (rank === 3) return "bg-amber-50";
  return "";
}

// ── Scope config ───────────────────────────────────────────────────────────────

const SCOPE_OPTIONS: { value: ScopeType; label: string; icon: React.ElementType; desc: string }[] = [
  { value: "school", label: "School",  icon: School,        desc: "All students in your school" },
  { value: "grade",  label: "Grade",   icon: GraduationCap, desc: "Students in your grade" },
  { value: "class",  label: "Class",   icon: Users,         desc: "Students in your class/section" },
];

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const ent = useEntitlements();
  const [scope, setScope] = useState<ScopeType>("school");
  const [period, setPeriod] = useState<"alltime" | "weekly">("alltime");
  const [subject, setSubject] = useState("");
  const [subjectsList, setSubjectsList] = useState<{ value: string; label: string }[]>([
    { value: "", label: "All Subjects" },
  ]);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSubjects() {
      try {
        const res = await fetch("/api/subjects");
        if (res.ok) {
          const json = await res.json();
          setSubjectsList([
            { value: "", label: "All Subjects" },
            ...(json.subjects as { id: string; name: string }[]).map((s) => ({
              value: s.name,
              label: s.name,
            })),
          ]);
        }
      } catch (err) {
        console.error("Failed to fetch subjects", err);
      }
    }
    fetchSubjects();
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ type: scope, period, subject });
      const res = await fetch(`/api/leaderboard?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load leaderboard");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [scope, period, subject]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Close subject dropdown when clicking outside
  useEffect(() => {
    if (!subjectOpen) return;
    const handler = () => setSubjectOpen(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [subjectOpen]);

  const leaderboard = data?.leaderboard ?? [];
  const currentUserRank = data?.currentUserRank ?? null;
  const currentUserInList = leaderboard.some((e) => e.isCurrentUser);
  const showCurrentUserFooter = !currentUserInList && currentUserRank !== null;
  const selectedSubjectLabel = subjectsList.find((s) => s.value === subject)?.label ?? "All Subjects";
  const activeScopeOption = SCOPE_OPTIONS.find((s) => s.value === scope)!;

  // Leaderboard is a premium feature — gate for plans without the entitlement.
  if (!ent.loading && !ent.leaderboard) {
    return <UpgradeNotice feature="Leaderboard" planName={ent.planName} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Trophy className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Leaderboard</h1>
          <p className="text-sm text-text-secondary">{activeScopeOption.desc}</p>
        </div>
      </div>

      {/* Scope tabs (SRS §4.9.1) */}
      <div className="flex gap-1 rounded-xl border border-border bg-gray-50 p-1">
        {SCOPE_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setScope(value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              scope === value
                ? "bg-white text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Period + Subject controls */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Period tabs */}
            <div className="flex rounded-lg border border-border bg-gray-50 p-0.5">
              <button
                onClick={() => setPeriod("alltime")}
                className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                  period === "alltime"
                    ? "bg-white text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                All Time
              </button>
              <button
                onClick={() => setPeriod("weekly")}
                className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                  period === "weekly"
                    ? "bg-white text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                This Week
              </button>
            </div>

            {/* Subject dropdown */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSubjectOpen((o) => !o);
                }}
                className="flex min-w-[160px] items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary shadow-sm hover:bg-gray-50"
              >
                <span>{selectedSubjectLabel}</span>
                <ChevronDown
                  className={`h-4 w-4 text-text-secondary transition-transform ${subjectOpen ? "rotate-180" : ""}`}
                />
              </button>
              {subjectOpen && (
                <div
                  className="absolute right-0 top-full z-10 mt-1 w-48 rounded-xl border border-border bg-white py-1 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  {subjectsList.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => { setSubject(s.value); setSubjectOpen(false); }}
                      className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                        subject === s.value ? "font-semibold text-primary" : "text-text-primary"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top 3 podium */}
      {!loading && !error && leaderboard.length >= 3 && (
        <div className="grid grid-cols-3 gap-3">
          <PodiumCard entry={leaderboard[1]} medal="silver" />
          <PodiumCard entry={leaderboard[0]} medal="gold" />
          <PodiumCard entry={leaderboard[2]} medal="bronze" />
        </div>
      )}

      {/* Rankings list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">
              Rankings
              {period === "weekly" && (
                <span className="ml-2 text-xs font-normal text-text-secondary">
                  (resets every Monday)
                </span>
              )}
            </h2>
            {currentUserRank !== null && (
              <span className="text-xs text-text-secondary">
                Your rank:{" "}
                <span className="font-semibold text-primary">#{currentUserRank}</span>
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-4 pt-2">
          {loading ? (
            <div className="space-y-0">
              {Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-text-secondary">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchLeaderboard}>Try Again</Button>
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <Trophy className="h-10 w-10 text-text-secondary/30" />
              <p className="text-sm text-text-secondary">
                No rankings yet for this {scope} / {period === "weekly" ? "week" : "period"}
              </p>
              <p className="text-xs text-text-secondary/60">
                Complete quizzes to appear on the leaderboard
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {leaderboard.map((entry) => <LeaderboardRow key={entry.userId} entry={entry} />)}
              {showCurrentUserFooter && (
                <>
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 border-t border-dashed border-border" />
                    <span className="text-xs text-text-secondary">your position</span>
                    <div className="flex-1 border-t border-dashed border-border" />
                  </div>
                  <CurrentUserStubRow rank={currentUserRank!} />
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Podium card ────────────────────────────────────────────────────────────────

function PodiumCard({ entry, medal }: { entry: LeaderboardEntry; medal: "gold" | "silver" | "bronze" }) {
  const colors = {
    gold:   { ring: "ring-2 ring-yellow-400", bg: "bg-yellow-400", text: "text-yellow-600", label: "1st" },
    silver: { ring: "ring-2 ring-gray-300",   bg: "bg-gray-300",   text: "text-gray-500",   label: "2nd" },
    bronze: { ring: "ring-2 ring-amber-600",  bg: "bg-amber-600",  text: "text-amber-700",  label: "3rd" },
  }[medal];

  return (
    <div
      className={`flex flex-col items-center rounded-xl border border-border bg-surface px-2 py-4 text-center shadow-sm ${
        entry.isCurrentUser ? "ring-1 ring-primary/40" : ""
      } ${medal === "gold" ? "order-2" : medal === "silver" ? "order-1" : "order-3"}`}
    >
      <div className={`mb-2 rounded-full p-1 ${colors.ring}`}>
        <Avatar name={entry.name} src={entry.avatarUrl} size={medal === "gold" ? "lg" : "md"} />
      </div>
      <p className="line-clamp-1 w-full text-xs font-semibold text-text-primary">{entry.name}</p>
      {entry.grade && <p className="text-[10px] text-text-secondary">Grade {entry.grade}</p>}
      <div className={`mt-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${colors.bg} text-white`}>
        {colors.label}
      </div>
      <p className={`mt-1 text-xs font-semibold ${colors.text}`}>
        {entry.totalPoints.toLocaleString()} pts
      </p>
    </div>
  );
}

// ── Leaderboard row ────────────────────────────────────────────────────────────

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${rowBackground(entry.rank, entry.isCurrentUser)}`}>
      <RankBadge rank={entry.rank} />
      <Avatar name={entry.name} src={entry.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={`truncate text-sm font-medium ${entry.isCurrentUser ? "text-primary" : "text-text-primary"}`}>
            {entry.name}
          </p>
          {entry.isCurrentUser && (
            <Badge variant="info" className="shrink-0 px-1.5 py-0 text-[10px]">You</Badge>
          )}
        </div>
        <p className="text-xs text-text-secondary">
          {entry.grade ? `Grade ${entry.grade}` : ""}
          {entry.grade && entry.section ? ` · ${entry.section}` : ""}
          {!entry.grade && !entry.section ? "Student" : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <div className="flex items-center gap-1">
          <Star className="h-3 w-3 text-yellow-400" />
          <span className="text-sm font-semibold text-text-primary">
            {entry.totalPoints.toLocaleString()}
          </span>
        </div>
        <Badge variant="default" className="px-1.5 py-0 text-[10px]">Lv {entry.xpLevel}</Badge>
      </div>
    </div>
  );
}

// ── Current user stub row ─────────────────────────────────────────────────────

function CurrentUserStubRow({ rank }: { rank: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-primary/5 px-3 py-2.5 ring-1 ring-primary/30">
      <div className="flex h-8 w-8 items-center justify-center">
        <span className="text-sm font-semibold text-primary">#{rank}</span>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20">
        <Star className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-primary">You</p>
          <Badge variant="info" className="shrink-0 px-1.5 py-0 text-[10px]">You</Badge>
        </div>
        <p className="text-xs text-text-secondary">Keep going to climb up!</p>
      </div>
    </div>
  );
}
