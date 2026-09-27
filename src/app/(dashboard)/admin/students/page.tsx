"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAdminBasePath } from "@/hooks/use-admin-base-path";
import Papa from "papaparse";
import {
  Users,
  Activity,
  TrendingUp,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  BookOpen,
  Upload,
  Download,
  X,
  FileText,
  UserPlus,
  GraduationCap,
  School,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { MAX_SECTION_LENGTH } from "@/lib/section";
import { PRIMARY_MAX_GRADE, SECONDARY_MAX_GRADE, SECONDARY_MIN_GRADE } from "@/lib/teacher-band";

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
  isActive: boolean;
  suspendedAt: string | null;
}

interface Stats {
  totalStudents: number;
  elementaryStudents: number;
  secondaryStudents: number;
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

type StatusFilter = "all" | "active" | "inactive" | "suspended";

type LevelFilter = "" | "elementary" | "secondary";

/** Grades offered by the grade filter for the chosen school level. */
function gradesForLevel(level: LevelFilter): number[] {
  const [from, to] =
    level === "elementary"
      ? [1, PRIMARY_MAX_GRADE]
      : level === "secondary"
      ? [SECONDARY_MIN_GRADE, SECONDARY_MAX_GRADE]
      : [1, SECONDARY_MAX_GRADE];
  return Array.from({ length: to - from + 1 }, (_, i) => i + from);
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
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

function getStudentStatus(student: Student): "active" | "inactive" | "suspended" {
  if (student.suspendedAt) return "suspended";
  if (!student.isActive) return "inactive";
  return "active";
}

// ── CSV Import Modal ─────────────────────────────────────────────────────────

function CsvImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const t = useTranslations("admin");
  const [csvText, setCsvText] = useState("");
  const [parsedRows, setParsedRows] = useState<Record<string, string>[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const blob = new Blob(["name,phone,grade,section\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      setParsedRows(null);
      setParseError(null);
      setResult(null);
    };
    reader.readAsText(file);
  }

  function handlePreview() {
    setParseError(null);
    setParsedRows(null);
    setResult(null);

    if (!csvText.trim()) {
      setParseError("No CSV content provided.");
      return;
    }

    const parsed = Papa.parse<Record<string, string>>(csvText.trim(), {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      setParseError(parsed.errors.map((e) => e.message).join("; "));
      return;
    }

    if (parsed.data.length === 0) {
      setParseError("No rows found in CSV.");
      return;
    }

    setParsedRows(parsed.data);
  }

  async function handleImport() {
    if (!csvText.trim()) return;
    setImporting(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData: csvText }),
      });

      const json = await res.json();

      if (!res.ok) {
        setResult({ imported: 0, skipped: 0, errors: [json.error || "Import failed"] });
        return;
      }

      setResult({
        imported: json.imported ?? 0,
        skipped: json.skipped ?? 0,
        errors: json.errors ?? [],
      });

      if ((json.imported ?? 0) > 0) {
        onImported();
      }
    } catch {
      setResult({ imported: 0, skipped: 0, errors: ["Network error during import."] });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardContent className="space-y-4 py-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">{t("importTitle")}</h2>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100">
              <X className="h-5 w-5 text-text-secondary" />
            </button>
          </div>

          {/* Template download */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-gray-50 p-3">
            <FileText className="h-5 w-5 text-text-secondary" />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">{t("csvTemplate")}</p>
              <p className="text-xs text-text-secondary">
                {t("csvTemplateDesc")}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={downloadTemplate} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              {t("downloadBtn")}
            </Button>
          </div>

          {/* File input */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-primary">
              {t("uploadCsvLabel")}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-sm file:font-medium file:text-primary"
            />
          </div>

          {/* Textarea */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-primary">
              {t("pasteCsvLabel")}
            </label>
            <textarea
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setParsedRows(null);
                setParseError(null);
                setResult(null);
              }}
              placeholder={"name,phone,grade,section\nAbebe Kebede,0911223344,9,A"}
              rows={5}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            />
          </div>

          {/* Preview + Import buttons */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePreview} disabled={!csvText.trim()}>
              {t("previewBtn")}
            </Button>
            <Button
              variant="primary"
              onClick={handleImport}
              disabled={!csvText.trim() || importing}
              className="gap-1.5"
            >
              {importing && <Spinner size="sm" />}
              {t("importBtn")}
            </Button>
          </div>

          {/* Parse error */}
          {parseError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-error">
              {parseError}
            </div>
          )}

          {/* Preview table */}
          {parsedRows && parsedRows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-text-secondary">#</th>
                    {Object.keys(parsedRows[0]).map((key) => (
                      <th key={key} className="px-3 py-2 text-left font-semibold text-text-secondary">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {parsedRows.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-text-secondary">{i + 1}</td>
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-3 py-2 text-text-primary">
                          {val}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 20 && (
                <p className="p-2 text-center text-xs text-text-secondary">
                  {t("showingRows", { count: parsedRows.length })}
                </p>
              )}
            </div>
          )}

          {/* Import result */}
          {result && (
            <div className="space-y-2 rounded-lg border border-border bg-gray-50 p-4">
              <h3 className="text-sm font-semibold text-text-primary">{t("importResults")}</h3>
              <div className="flex flex-wrap gap-3">
                <Badge variant="success">{t("importedCount", { count: result.imported })}</Badge>
                <Badge variant="default">{t("skippedCount", { count: result.skipped })}</Badge>
                {result.errors.length > 0 && (
                  <Badge variant="error">{t("errorsCount", { count: result.errors.length })}</Badge>
                )}
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-2 max-h-32 overflow-y-auto space-y-1 text-xs text-error">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

// ── Add a single student ──────────────────────────────────────────────────────
function AddStudentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [grade, setGrade] = useState("");
  const [section, setSection] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectClass =
    "w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone number are required.");
      return;
    }
    // Section is required: class rosters and every cohort view are keyed on it,
    // so a student without one belongs to no class.
    if (!section.trim()) {
      setError("Section is required — e.g. A.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Normalise so a pasted 0912…, 251912…, or +251912… also works.
      const localDigits = phone.trim().replace(/\D/g, "").replace(/^251/, "").replace(/^0/, "");
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: `+251${localDigits}`,
          grade: grade || undefined,
          section,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to add student.");
        return;
      }
      toast.success("Student added successfully!");
      onAdded();
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="relative w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">Add Student</h2>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100" aria-label="Close">
              <X className="h-5 w-5 text-text-secondary" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-text-muted">Full Name</label>
              <Input placeholder="e.g. Abebe Kebede" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-text-muted">Phone Number</label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-gray-50 px-3 text-sm text-text-secondary">
                  +251
                </span>
                <Input
                  placeholder="9XXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={saving}
                  className="rounded-l-none"
                  inputMode="numeric"
                />
              </div>
              <p className="text-xs text-text-muted">The student signs in with this number via OTP.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-muted">Grade</label>
                <select className={selectClass} value={grade} onChange={(e) => setGrade(e.target.value)} disabled={saving}>
                  <option value="">Select…</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                    <option key={g} value={g}>Grade {g}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-muted">Section *</label>
                <Input
                  placeholder='e.g. "A"'
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  disabled={saving}
                  maxLength={MAX_SECTION_LENGTH}
                  required
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button type="submit" isLoading={saving} className="flex-1 gap-1.5">
                <UserPlus className="h-4 w-4" />
                Add Student
              </Button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminStudentsContent() {
  const t = useTranslations("admin");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const basePath = useAdminBasePath();

  const [data, setData] = useState<StudentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState(
    searchParams.get("search") ?? ""
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const currentSearch = searchParams.get("search") ?? "";
  const currentLevel = (searchParams.get("level") ?? "") as LevelFilter;
  const currentGrade = searchParams.get("grade") ?? "";
  const currentSection = searchParams.get("section") ?? "";
  const currentSort = searchParams.get("sort") ?? "points";
  const currentPage = parseInt(searchParams.get("page") ?? "1", 10);

  const [reloadCount, setReloadCount] = useState(0);

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
    if (!("page" in overrides)) overrides.page = 1;
    router.push(buildUrl(overrides));
  }

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

  useEffect(() => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (currentSearch) params.set("search", currentSearch);
    if (currentLevel) params.set("level", currentLevel);
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
  }, [currentSearch, currentLevel, currentGrade, currentSection, currentSort, currentPage, reloadCount]);

  const filteredStudents = data
    ? statusFilter === "all"
      ? data.students
      : data.students.filter((s) => getStudentStatus(s) === statusFilter)
    : [];

  function statusBadge(student: Student) {
    const status = getStudentStatus(student);
    switch (status) {
      case "active":
        return <Badge variant="success">{t("statusActive")}</Badge>;
      case "inactive":
        return <Badge variant="default">{t("statusInactive")}</Badge>;
      case "suspended":
        return <Badge variant="error">{t("statusSuspended")}</Badge>;
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">{t("studentsTitle")}</h1>
          {data && (
            <Badge variant="info" className="text-sm px-3 py-1">
              {data.total.toLocaleString()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowImportModal(true)}
            className="gap-1.5"
          >
            <Upload className="h-4 w-4" />
            {t("importStudents")}
          </Button>
          <Button onClick={() => setShowAddModal(true)} className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            Add Student
          </Button>
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
            <span className="text-text-secondary">{t("totalStudentsPill")}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-sm">
            <School className="h-4 w-4 text-amber-600" />
            <span className="font-semibold text-text-primary">
              {data.stats.elementaryStudents.toLocaleString()}
            </span>
            <span className="text-text-secondary">{t("levelElementaryShort")}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-sm">
            <GraduationCap className="h-4 w-4 text-primary" />
            <span className="font-semibold text-text-primary">
              {data.stats.secondaryStudents.toLocaleString()}
            </span>
            <span className="text-text-secondary">{t("levelSecondaryShort")}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-sm">
            <Activity className="h-4 w-4 text-success" />
            <span className="font-semibold text-text-primary">
              {data.stats.activeThisWeek.toLocaleString()}
            </span>
            <span className="text-text-secondary">{t("activeThisWeek")}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-sm">
            <TrendingUp className="h-4 w-4 text-info" />
            <span className="font-semibold text-text-primary">
              {data.stats.avgPoints.toLocaleString()}
            </span>
            <span className="text-text-secondary">{t("avgPoints")}</span>
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
            placeholder={t("searchPlaceholder")}
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Level filter — elementary (1-8) vs secondary (9-12) */}
        <select
          value={currentLevel}
          onChange={(e) => {
            const level = e.target.value as LevelFilter;
            // Drop a grade that falls outside the newly chosen level.
            const keepGrade =
              currentGrade && gradesForLevel(level).includes(Number(currentGrade));
            pushUrl({ level, grade: keepGrade ? currentGrade : undefined });
          }}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">{t("allLevels")}</option>
          <option value="elementary">{t("levelElementary")}</option>
          <option value="secondary">{t("levelSecondary")}</option>
        </select>

        {/* Grade filter */}
        <select
          value={currentGrade}
          onChange={(e) => pushUrl({ grade: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">{t("allGrades")}</option>
          {gradesForLevel(currentLevel).map((g) => (
            <option key={g} value={g}>
              {t("gradeLabel", { grade: g })}
            </option>
          ))}
        </select>

        {/* Section filter */}
        <input
          type="text"
          placeholder={t("sectionPlaceholder")}
          value={currentSection}
          onChange={(e) => pushUrl({ section: e.target.value })}
          className="w-24 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">{t("allStatus")}</option>
          <option value="active">{t("statusActive")}</option>
          <option value="inactive">{t("statusInactive")}</option>
          <option value="suspended">{t("statusSuspended")}</option>
        </select>

        {/* Sort */}
        <select
          value={currentSort}
          onChange={(e) => pushUrl({ sort: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="points">{t("sortPoints")}</option>
          <option value="name">{t("sortName")}</option>
          <option value="recent">{t("sortRecent")}</option>
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
            {t("tryAgain")}
          </Button>
        </div>
      ) : !data || filteredStudents.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16 text-center">
            <BookOpen className="h-12 w-12 text-text-secondary/30" />
            <p className="text-lg font-medium text-text-primary">
              {t("noStudentsFound")}
            </p>
            <p className="text-sm text-text-secondary">
              {currentSearch || currentLevel || currentGrade || currentSection || statusFilter !== "all"
                ? t("noStudentsFiltered")
                : t("noStudentsEnrolled")}
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
                    {t("colStudent")}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    {t("colPhone")}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    {t("colGradeSection")}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    {t("colStatus")}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    {t("colXpPoints")}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    {t("colQuizzes")}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                    {t("colLastActive")}
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-text-secondary">
                    {t("colActions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {filteredStudents.map((student) => (
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
                        ? `${t("gradeLabel", { grade: student.grade })}${student.section ? ` / ${student.section}` : ""}`
                        : "\u2014"}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      {statusBadge(student)}
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
                        <span className="text-xs text-text-secondary">{t("ptsLabel")}</span>
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
                      <Link href={`${basePath}/students/${student.id}`}>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Eye className="h-3.5 w-3.5" />
                          {t("viewBtn")}
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
            {filteredStudents.map((student) => (
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
                            ? `${t("gradeLabel", { grade: student.grade })}${student.section ? ` / ${student.section}` : ""}`
                            : t("noGrade")}
                        </p>
                      </div>
                    </div>

                    <Link href={`${basePath}/students/${student.id}`}>
                      <Button size="sm" variant="outline">
                        {t("viewBtn")}
                      </Button>
                    </Link>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {statusBadge(student)}
                    <Badge variant="info">
                      {student.totalPoints.toLocaleString()} {t("ptsLabel")}
                    </Badge>
                    <Badge variant="default">
                      {t("lvlLabel", { level: student.xpLevel })}
                    </Badge>
                    <span className="text-xs text-text-secondary">
                      {t("quizzesCount", { count: student.quizCount })}
                    </span>
                    <span className="ml-auto text-xs text-text-secondary">
                      {t("activeLabel", { time: relativeTime(student.lastActiveAt) })}
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
                {t("prevBtn")}
              </Button>

              {Array.from({ length: data.totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === data.totalPages ||
                    Math.abs(p - currentPage) <= 2
                )
                .reduce<(number | "\u2026")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1)
                    acc.push("\u2026");
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === "\u2026" ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-2 text-text-secondary"
                    >
                      ...
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
                {t("nextBtn")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <CsvImportModal
          onClose={() => setShowImportModal(false)}
          onImported={() => setReloadCount((c) => c + 1)}
        />
      )}

      {/* Add Single Student Modal */}
      {showAddModal && (
        <AddStudentModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => setReloadCount((c) => c + 1)}
        />
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
