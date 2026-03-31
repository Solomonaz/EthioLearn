"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Users,
  Activity,
  TrendingUp,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  BookOpen,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Student {
  id: string;
  name: string;
  phoneNumber: string;
  grade: number | null;
  section: string | null;
  xpLevel: number;
  totalPoints: number;
  avatarUrl: string | null;
  streakDays: number;
  lastActiveAt: string | null;
  createdAt: string;
  quizCount: number;
}

interface Stats {
  totalStudents: number;
  activeThisWeek: number;
  avgPoints: number;
}

interface StudentsResponse {
  students: Student[];
  total: number;
  page: number;
  totalPages: number;
  stats: Stats;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

function AdminStudentsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [data, setData] = useState<StudentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local state for search input (debounced before hitting API)
  const [searchInput, setSearchInput] = useState(
    searchParams.get("search") ?? ""
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive filter state from URL
  const currentSearch = searchParams.get("search") ?? "";
  const currentGrade = searchParams.get("grade") ?? "";
  const currentSection = searchParams.get("section") ?? "";
  const currentSort = searchParams.get("sort") ?? "points";
  const currentPage = parseInt(searchParams.get("page") ?? "1", 10);

  // ── URL helpers ─────────────────────────────────────────────────────────────

  function buildUrl(overrides: Record<string, string | number | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(overrides)) {
      if (val === undefined || val === "") {
        params.delete(key);
      } else {
        params.set(key, String(val));
      }
    }
    return `${pathname}?${params.toString()}`;
  }

  function pushUrl(overrides: Record<string, string | number | undefined>) {
    // Reset page to 1 on filter changes (unless explicitly overriding page)
    if (!("page" in overrides)) overrides.page = 1;
    router.push(buildUrl(overrides));
  }

  // ── Debounce search input → URL ─────────────────────────────────────────────

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        pushUrl({ search: value });
      }, 300);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams]
  );

  // ── Fetch data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (currentSearch) params.set("search", currentSearch);
    if (currentGrade) params.set("grade", currentGrade);
    if (currentSection) params.set("section", currentSection);
    if (currentSort) params.set("sort", currentSort);
    params.set("page", String(currentPage));
    params.set("limit", "20");

    fetch(`/api/admin/students?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load students");
        return res.json();
      })
      .then((json: StudentsResponse) => {
        setData(json);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Something went wrong");
      })
      .finally(() => setLoading(false));
  }, [currentSearch, currentGrade, currentSection, currentSort, currentPage]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">Students</h1>
          {data && (
            <Badge variant="info" className="text-sm px-3 py-1">
              {data.total.toLocaleString()}
            </Badge>
          )}
        </div>
      </div>

      {/* ── Stats pills ─────────────────────────────────────────────────────── */}
      {data && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-sm">
            <Users className="h-4 w-4 text-primary" />
            <span className="font-semibold text-text-primary">
              {data.stats.totalStudents.toLocaleString()}
            </span>
            <span className="text-text-secondary">Total Students</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-sm">
            <Activity className="h-4 w-4 text-success" />
            <span className="font-semibold text-text-primary">
              {data.stats.activeThisWeek.toLocaleString()}
            </span>
            <span className="text-text-secondary">Active This Week</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-sm">
            <TrendingUp className="h-4 w-4 text-info" />
            <span className="font-semibold text-text-primary">
              {data.stats.avgPoints.toLocaleString()}
            </span>
            <span className="text-text-secondary">Avg Points</span>
          </div>
        </div>
      )}

      {/* ── Filters bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="Search by name or phone…"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Grade filter */}
        <select
          value={currentGrade}
          onChange={(e) => pushUrl({ grade: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">All Grades</option>
          {[9, 10, 11, 12].map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>

        {/* Section filter */}
        <input
          type="text"
          placeholder="Section…"
          value={currentSection}
          onChange={(e) => pushUrl({ section: e.target.value })}
          className="w-24 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        {/* Sort */}
        <select
          value={currentSort}
          onChange={(e) => pushUrl({ sort: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="points">Top Points</option>
          <option value="name">Name A–Z</option>
          <option value="recent">Recently Active</option>
        </select>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner size="lg" className="text-primary" />
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
          <p className="text-text-secondary">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      ) : !data || data.students.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16 text-center">
            <BookOpen className="h-12 w-12 text-text-secondary/30" />
            <p className="text-lg font-medium text-text-primary">
              No students found
            </p>
            <p className="text-sm text-text-secondary">
              {currentSearch || currentGrade || currentSection
                ? "Try adjusting your filters."
                : "No students have been enrolled yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-border shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    Student
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    Phone
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    Grade / Section
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    XP / Points
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    Quizzes
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    Last Active
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-text-secondary">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {data.students.map((student) => (
                  <tr
                    key={student.id}
                    className="transition-colors hover:bg-gray-50/60"
                  >
                    {/* Avatar + Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={student.name}
                          src={student.avatarUrl ?? undefined}
                          size="sm"
                        />
                        <span className="font-medium text-text-primary">
                          {student.name}
                        </span>
                      </div>
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3 text-text-secondary">
                      {student.phoneNumber}
                    </td>

                    {/* Grade / Section */}
                    <td className="px-4 py-3 text-text-secondary">
                      {student.grade
                        ? `Grade ${student.grade}${student.section ? ` / ${student.section}` : ""}`
                        : "—"}
                    </td>

                    {/* XP Level + Total Points */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                          {student.xpLevel}
                        </span>
                        <span className="font-semibold text-primary">
                          {student.totalPoints.toLocaleString()}
                        </span>
                        <span className="text-xs text-text-secondary">pts</span>
                      </div>
                    </td>

                    {/* Quizzes Taken */}
                    <td className="px-4 py-3 text-text-secondary">
                      {student.quizCount}
                    </td>

                    {/* Last Active */}
                    <td className="px-4 py-3 text-text-secondary">
                      {relativeTime(student.lastActiveAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/students/${student.id}`}>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {data.students.map((student) => (
              <Card key={student.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={student.name}
                        src={student.avatarUrl ?? undefined}
                        size="md"
                      />
                      <div>
                        <p className="font-semibold text-text-primary">
                          {student.name}
                        </p>
                        <p className="text-xs text-text-secondary">
                          {student.grade
                            ? `Grade ${student.grade}${student.section ? ` / ${student.section}` : ""}`
                            : "No grade"}
                        </p>
                      </div>
                    </div>

                    <Link href={`/admin/students/${student.id}`}>
                      <Button size="sm" variant="outline">
                        View
                      </Button>
                    </Link>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="info">
                      {student.totalPoints.toLocaleString()} pts
                    </Badge>
                    <Badge variant="default">
                      Lvl {student.xpLevel}
                    </Badge>
                    <span className="text-xs text-text-secondary">
                      {student.quizCount} quizzes
                    </span>
                    <span className="ml-auto text-xs text-text-secondary">
                      Active {relativeTime(student.lastActiveAt)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => pushUrl({ page: currentPage - 1 })}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>

              {Array.from({ length: data.totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === data.totalPages ||
                    Math.abs(p - currentPage) <= 2
                )
                .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1)
                    acc.push("…");
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === "…" ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-2 text-text-secondary"
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === currentPage ? "primary" : "outline"}
                      size="sm"
                      onClick={() => pushUrl({ page: item as number })}
                    >
                      {item}
                    </Button>
                  )
                )}

              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= data.totalPages}
                onClick={() => pushUrl({ page: currentPage + 1 })}
                className="gap-1"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminStudentsPage() {
  return (
    <Suspense fallback={null}>
      <AdminStudentsContent />
    </Suspense>
  );
}
