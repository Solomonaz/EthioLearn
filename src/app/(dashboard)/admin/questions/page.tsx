"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useAdminBasePath } from "@/hooks/use-admin-base-path";
import {
  HelpCircle,
  Pencil,
  Trash2,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  XCircle,
  Download,
  Sparkles,
  Check,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import Papa from "papaparse";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────

type Difficulty = "EASY" | "MEDIUM" | "HARD";
type QuestionType = "MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING";

interface TextbookChapter {
  id: string;
  title: string;
  chapterNumber: number;
}

interface TextbookOption {
  id: string;
  title: string;
  subject: string;
  grade: number;
  hasContent: boolean;
  contentLength: number;
  chapters: TextbookChapter[];
}

interface QuestionItem {
  id: string;
  type: QuestionType;
  difficulty: Difficulty;
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string | null;
  videoUrl: string | null;
  usageCount: number;
  avgAccuracy: number | null;
  language: string;
  createdAt: string;
  chapterId: string;
  chapter: {
    id: string;
    title: string;
    chapterNumber: number;
    textbook: {
      id: string;
      title: string;
      subject: string;
      grade: number;
    };
  };
}

interface FetchResult {
  questions: QuestionItem[];
  total: number;
  page: number;
  totalPages: number;
  textbooks: TextbookOption[];
}

// ─── Constants ────────────────────────────────────────────

const DIFFICULTY_OPTIONS: { value: Difficulty | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "EASY", label: "Easy" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HARD", label: "Hard" },
];

const DIFFICULTY_BADGE_VARIANT: Record<
  Difficulty,
  "difficulty-easy" | "difficulty-medium" | "difficulty-hard"
> = {
  EASY: "difficulty-easy",
  MEDIUM: "difficulty-medium",
  HARD: "difficulty-hard",
};

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "MCQ", label: "Multiple Choice" },
  { value: "TRUE_FALSE", label: "True / False" },
  { value: "FILL_IN_BLANK", label: "Fill in the Blank" },
  { value: "MATCH_PAIRS", label: "Match Pairs" },
  { value: "ORDERING", label: "Ordering" },
];

const SELECT_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary";

const LABEL_CLASS = "mb-1.5 block text-sm font-medium text-text-primary";

// Flags serious enough that an AI-generated question should be reviewed before
// saving — the solver disagreed/couldn't verify, OR a structural defect exists.
const REVIEW_FLAGS = new Set([
  "WEAK_OPTION",
  "COMPOUND_QUESTION",
  "META_REFERENCE",
  "INVALID_ANSWER",
  "TOO_SHORT",
  "WRONG_KEY",
  "MULTI_ANSWER",
  "UNVERIFIED",
  "FACTUAL_ERROR",
  "LOW_RELEVANCE",
]);

function aiNeedsReview(q: { qualityVerified?: boolean; qualityFlags?: string[] }): boolean {
  if (q.qualityVerified === false) return true;
  return (q.qualityFlags ?? []).some((f) => REVIEW_FLAGS.has(f));
}

// Draft key so a page reload (Fast Refresh, session refresh, accidental nav)
// doesn't lose a batch of AI-generated questions the admin is still reviewing.
const AI_DRAFT_KEY = "ethiolearn:admin:ai-draft:v1";

// ─── Main Component ───────────────────────────────────────

export default function AdminQuestionsPage() {
  const t = useTranslations("admin");
  const basePath = useAdminBasePath();

  // ── Filter state ─────────────────────────────────────────
  const [filterTextbookId, setFilterTextbookId] = useState("");
  const [filterChapterId, setFilterChapterId] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | "ALL">("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // ── Data state ───────────────────────────────────────────
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [textbooks, setTextbooks] = useState<TextbookOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Delete state ─────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Form state ───────────────────────────────────────────
  const [editingQuestion, setEditingQuestion] = useState<QuestionItem | null>(null);
  const [formTextbookId, setFormTextbookId] = useState("");
  const [formChapterId, setFormChapterId] = useState("");
  const [formQuestionText, setFormQuestionText] = useState("");
  const [formOptions, setFormOptions] = useState(["", "", "", ""]);
  const [formCorrectAnswer, setFormCorrectAnswer] = useState("");
  const [formDifficulty, setFormDifficulty] = useState<Difficulty>("MEDIUM");
  const [formType, setFormType] = useState<QuestionType>("MCQ");
  const [formExplanation, setFormExplanation] = useState("");
  const [formVideoUrl, setFormVideoUrl] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Collapsible "Add Question" panel ─────────────────────
  const [addOpen, setAddOpen] = useState(false);

  // ── Tab + Bulk Import state ───────────────────────────────
  const [activeTab, setActiveTab] = useState<"single" | "bulk" | "ai">("single");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: { row: number; reason: string }[];
  } | null>(null);
  const [bulkTextbookId, setBulkTextbookId] = useState<string | null>(null);
  const [bulkChapterId, setBulkChapterId] = useState<string | null>(null);

  // ── AI Generate state — uses already-uploaded textbooks ──────────
  const [aiTextbookId, setAiTextbookId] = useState("");
  const [aiChapterId, setAiChapterId] = useState("");
  const [aiCount, setAiCount] = useState(10);
  const [aiDifficulty, setAiDifficulty] = useState("MIXED");
  const [aiQuestionTypes, setAiQuestionTypes] = useState<string[]>(["MCQ"]);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<
    {
      questionText: string;
      type: string;
      options: string[];
      correctAnswer: string;
      difficulty: string;
      explanation: string;
      qualityVerified?: boolean;
      qualityFlags?: string[];
      qualityDetails?: Record<string, string>;
      _selected: boolean;
    }[]
  >([]);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftHydrated = useRef(false);

  // ── Restore an in-progress AI batch after a reload ───────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Array.isArray(d.questions) && d.questions.length > 0) {
        setAiQuestions(d.questions);
        if (d.textbookId) setAiTextbookId(d.textbookId);
        if (d.chapterId) setAiChapterId(d.chapterId);
        setActiveTab("ai");
        setAddOpen(true);
        toast.info("Restored your unsaved AI-generated questions.");
      }
    } catch {
      /* ignore malformed draft */
    }
  }, []);

  // ── Persist the AI batch so a refresh never loses it ─────
  useEffect(() => {
    // Skip the first run so restoring a draft doesn't immediately overwrite it.
    if (!draftHydrated.current) {
      draftHydrated.current = true;
      return;
    }
    try {
      if (aiQuestions.length > 0) {
        localStorage.setItem(
          AI_DRAFT_KEY,
          JSON.stringify({ textbookId: aiTextbookId, chapterId: aiChapterId, questions: aiQuestions }),
        );
      } else {
        localStorage.removeItem(AI_DRAFT_KEY);
      }
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [aiQuestions, aiTextbookId, aiChapterId]);

  // ── Derived: chapters for filter dropdown ────────────────
  const filterChapters =
    textbooks.find((t) => t.id === filterTextbookId)?.chapters ?? [];

  // ── Derived: chapters for form dropdown ─────────────────
  const formChapters =
    textbooks.find((t) => t.id === formTextbookId)?.chapters ?? [];

  // ── Derived: valid options for correct answer dropdown ───
  const validOptions = formOptions.filter((o) => o.trim() !== "");

  // ─── Fetch questions ─────────────────────────────────────

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (filterTextbookId) params.set("textbookId", filterTextbookId);
      if (filterChapterId) params.set("chapterId", filterChapterId);
      if (filterDifficulty !== "ALL") params.set("difficulty", filterDifficulty);
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", "20");

      const res = await fetch(`/api/admin/questions?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load questions");
      const data: FetchResult = await res.json();
      setQuestions(data.questions ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setTextbooks(data.textbooks ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [filterTextbookId, filterChapterId, filterDifficulty, search, page]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  // Clear any pending debounce on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // Debounce search input
  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 400);
  }

  // ─── Reset page when filters change ──────────────────────

  function handleFilterTextbookChange(id: string) {
    setFilterTextbookId(id);
    setFilterChapterId("");
    setPage(1);
  }

  function handleFilterChapterChange(id: string) {
    setFilterChapterId(id);
    setPage(1);
  }

  function handleFilterDifficultyChange(d: Difficulty | "ALL") {
    setFilterDifficulty(d);
    setPage(1);
  }

  // ─── Form helpers ─────────────────────────────────────────

  function clearForm() {
    setEditingQuestion(null);
    setFormTextbookId("");
    setFormChapterId("");
    setFormQuestionText("");
    setFormOptions(["", "", "", ""]);
    setFormCorrectAnswer("");
    setFormDifficulty("MEDIUM");
    setFormType("MCQ");
    setFormExplanation("");
    setFormVideoUrl("");
    setFormError(null);
  }

  // Open the collapsible panel in a clean "add" state.
  function openAddPanel() {
    clearForm();
    setActiveTab("single");
    setAddOpen(true);
  }

  // Close the panel and discard any in-progress add/edit.
  function closeAddPanel() {
    clearForm();
    setAddOpen(false);
  }

  function startEdit(question: QuestionItem) {
    setActiveTab("single");
    setAddOpen(true);
    setEditingQuestion(question);
    setFormTextbookId(question.chapter.textbook.id);
    setFormChapterId(question.chapter.id);
    setFormQuestionText(question.questionText);
    // Pad or trim options to 4 slots
    const opts = [...question.options];
    while (opts.length < 4) opts.push("");
    setFormOptions(opts.slice(0, 4));
    setFormCorrectAnswer(question.correctAnswer);
    setFormDifficulty(question.difficulty);
    setFormType(question.type);
    setFormExplanation(question.explanation ?? "");
    setFormVideoUrl(question.videoUrl ?? "");
    setFormError(null);
  }

  function handleOptionChange(index: number, value: string) {
    setFormOptions((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    // Clear correctAnswer if it no longer matches any option
    setFormCorrectAnswer((prev) => {
      const next = [...formOptions];
      next[index] = value;
      if (prev && !next.filter((o) => o.trim()).includes(prev)) return "";
      return prev;
    });
  }

  // ─── Submit form ─────────────────────────────────────────

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!formChapterId) {
      setFormError("Please select a chapter.");
      return;
    }
    if (!formQuestionText.trim()) {
      setFormError("Question text is required.");
      return;
    }
    const cleanOptions = formOptions.filter((o) => o.trim() !== "");
    if (cleanOptions.length < 2) {
      setFormError("At least 2 options are required.");
      return;
    }
    if (!formCorrectAnswer || !cleanOptions.includes(formCorrectAnswer)) {
      setFormError("Please select a valid correct answer from the options.");
      return;
    }

    setFormSubmitting(true);
    try {
      const payload = {
        chapterId: formChapterId,
        questionText: formQuestionText.trim(),
        options: cleanOptions,
        correctAnswer: formCorrectAnswer,
        difficulty: formDifficulty,
        type: formType,
        explanation: formExplanation.trim() || undefined,
        videoUrl: formVideoUrl.trim() || undefined,
      };

      let res: Response;
      if (editingQuestion) {
        const { chapterId: _c, ...patchPayload } = payload;
        void _c;
        res = await fetch(`/api/admin/questions/${editingQuestion.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchPayload),
        });
      } else {
        res = await fetch("/api/admin/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Request failed");
      }

      toast.success(editingQuestion ? "Question updated." : "Question created.");
      clearForm();
      await fetchQuestions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setFormSubmitting(false);
    }
  }

  // ─── Delete ───────────────────────────────────────────────

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/questions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      setTotal((prev) => prev - 1);
      if (editingQuestion?.id === id) clearForm();
      toast.success("Question deleted.");
    } catch {
      toast.error("Failed to delete question.");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  // ─── Bulk Import helpers ──────────────────────────────────

  function handleCsvFile(file: File | null) {
    setCsvFile(file);
    setImportResult(null);
    if (!file) { setCsvPreview([]); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
      setCsvPreview(parsed.data.slice(0, 6)); // header + 5 rows
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const headers = "questionText,optionA,optionB,optionC,optionD,correctAnswer,difficulty,explanation";
    const example = "What is the powerhouse of the cell?,Nucleus,Mitochondria,Ribosome,Cell wall,Mitochondria,EASY,Mitochondria produce ATP energy";
    const csv = `${headers}\n${example}\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "questions-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    if (!csvFile || !bulkChapterId) return;
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("chapterId", bulkChapterId);
      fd.append("file", csvFile);
      const res = await fetch("/api/admin/questions/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResult(data);
      setCsvFile(null);
      setCsvPreview([]);
      fetchQuestions(); // refresh the list
    } catch (err) {
      setImportResult({
        imported: 0,
        skipped: 0,
        errors: [{ row: 0, reason: err instanceof Error ? err.message : "Unknown error" }],
      });
    } finally {
      setImporting(false);
    }
  }

  // ── AI handler functions ─────────────────────────────────

  const aiSelectedTb = textbooks.find((t) => t.id === aiTextbookId);
  const aiChapters = aiSelectedTb?.chapters ?? [];

  function handleAiTextbookChange(tbId: string) {
    setAiTextbookId(tbId);
    setAiChapterId("");
    setAiQuestions([]);
    setAiError(null);
  }

  async function handleAiGenerate() {
    if (!aiTextbookId || !aiChapterId) return;
    if (aiQuestionTypes.length === 0) {
      setAiError("Please select at least one question type.");
      return;
    }
    setAiGenerating(true);
    setAiError(null);
    setAiQuestions([]);
    try {
      const res = await fetch(
        `/api/admin/textbooks/${aiTextbookId}/chapters/${aiChapterId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            count: aiCount,
            difficulty: aiDifficulty,
            questionTypes: aiQuestionTypes,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "AI generation failed");
      }
      const data = await res.json();
      setAiQuestions(
        (data.questions ?? []).map((q: Record<string, unknown>) => ({
          ...q,
          // Pre-select only clean questions; any that failed verification OR
          // carry a serious structural flag are left unchecked so they aren't
          // saved without a deliberate look.
          _selected: !aiNeedsReview(q),
        }))
      );
      const flaggedCount = (data.questions ?? []).filter(
        (q: Record<string, unknown>) => aiNeedsReview(q)
      ).length;
      const verifiedCount = (data.questions?.length ?? 0) - flaggedCount;
      toast.success(
        `Generated ${data.questions?.length ?? 0} questions — ${verifiedCount} verified` +
          (flaggedCount > 0 ? `, ${flaggedCount} need review.` : ".")
      );
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI generation failed");
    } finally {
      setAiGenerating(false);
    }
  }

  async function handleAiSaveQuestions() {
    const selected = aiQuestions.filter((q) => q._selected);
    if (selected.length === 0) { setAiError("Select at least one question."); return; }
    setAiSaving(true);
    setAiError(null);
    try {
      const res = await fetch(
        `/api/admin/textbooks/${aiTextbookId}/chapters/${aiChapterId}/questions/batch`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questions: selected.map(({ _selected: _, ...q }) => q), publish: true }) }
      );
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Save failed"); }
      const data = await res.json();
      toast.success(`Saved ${data.saved} questions.`);
      setAiQuestions([]);
      fetchQuestions();
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Failed to save questions");
    } finally {
      setAiSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────

  const panelOpen = addOpen || !!editingQuestion;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Page header — title + collapsible "Add Question" toggle */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t("questionsTitle")}</h1>
          <p className="text-sm text-text-secondary">
            {t("analyticsSubtitle")}
          </p>
        </div>
        <Button
          onClick={() => (panelOpen ? closeAddPanel() : openAddPanel())}
          variant={panelOpen ? "outline" : "primary"}
          className="shrink-0 gap-2"
        >
          {panelOpen ? (
            <>
              <X className="h-4 w-4" /> Close
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Add Question
            </>
          )}
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        {/* ════════════════════════════════════════
            LEFT PANEL — Filters + Question List
        ════════════════════════════════════════ */}
        <div className="order-2 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold text-text-primary">
                    Questions
                    {!loading && (
                      <span className="ml-2 text-sm font-normal text-text-secondary">
                        ({total})
                      </span>
                    )}
                  </h2>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchQuestions}
                  disabled={loading}
                >
                  {loading ? <Spinner size="sm" /> : "Refresh"}
                </Button>
              </div>
            </CardHeader>

            {/* Filters */}
            <div className="border-b border-border px-4 pb-4 pt-0 space-y-3">
              {/* Textbook + Chapter row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLASS}>Textbook</label>
                  <select
                    value={filterTextbookId}
                    onChange={(e) => handleFilterTextbookChange(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">All textbooks</option>
                    {textbooks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} (Gr {t.grade})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={LABEL_CLASS}>Chapter</label>
                  <select
                    value={filterChapterId}
                    onChange={(e) => handleFilterChapterChange(e.target.value)}
                    disabled={!filterTextbookId}
                    className={SELECT_CLASS}
                  >
                    <option value="">All chapters</option>
                    {filterChapters.map((c) => (
                      <option key={c.id} value={c.id}>
                        Ch {c.chapterNumber}: {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Difficulty pills + Search */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleFilterDifficultyChange(opt.value as Difficulty | "ALL")}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        filterDifficulty === opt.value
                          ? "bg-primary text-white"
                          : "bg-border/50 text-text-secondary hover:bg-border hover:text-text-primary"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="relative flex-1 min-w-[140px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    placeholder="Search questions…"
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInput("");
                        setSearch("");
                        setPage(1);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Question list */}
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner size="md" className="text-primary" />
                </div>
              ) : fetchError ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <XCircle className="h-8 w-8 text-error" />
                  <p className="text-sm text-text-secondary">{fetchError}</p>
                  <Button variant="outline" size="sm" onClick={fetchQuestions}>
                    Try Again
                  </Button>
                </div>
              ) : questions.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <HelpCircle className="h-10 w-10 text-text-muted" />
                  <p className="text-sm text-text-secondary">No questions found.</p>
                  <p className="text-xs text-text-muted">
                    Click <span className="font-medium text-text-secondary">Add Question</span> above to create one.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {questions.map((q) => {
                    const isConfirming = confirmDeleteId === q.id;
                    const isDeleting = deletingId === q.id;
                    const isEditing = editingQuestion?.id === q.id;

                    return (
                      <div
                        key={q.id}
                        className={`flex items-start justify-between gap-3 px-4 py-3 transition-colors ${
                          isEditing ? "bg-primary/5" : "hover:bg-border/20"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm text-text-primary">
                            {q.questionText}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                            <Badge variant={DIFFICULTY_BADGE_VARIANT[q.difficulty]}>
                              {q.difficulty}
                            </Badge>
                            <span className="text-text-muted">
                              Used {q.usageCount}×
                            </span>
                            <span className="truncate text-text-muted">
                              {q.chapter.textbook.title} › Ch {q.chapter.chapterNumber}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {isConfirming ? (
                            <>
                              <span className="text-xs text-text-secondary">Delete?</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                No
                              </Button>
                              <Button
                                size="sm"
                                isLoading={isDeleting}
                                className="bg-red-600 text-white hover:bg-red-700"
                                onClick={() => handleDelete(q.id)}
                              >
                                Yes
                              </Button>
                            </>
                          ) : (
                            <>
                              <button
                                className={`rounded-lg p-1.5 transition-colors ${
                                  isEditing
                                    ? "bg-primary/10 text-primary"
                                    : "text-text-muted hover:bg-primary/10 hover:text-primary"
                                }`}
                                title="Edit question"
                                onClick={() => (isEditing ? clearForm() : startEdit(q))}
                              >
                                {isEditing ? (
                                  <X className="h-4 w-4" />
                                ) : (
                                  <Pencil className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Delete question"
                                disabled={isDeleting}
                                onClick={() => setConfirmDeleteId(q.id)}
                              >
                                {isDeleting ? (
                                  <Spinner size="sm" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-xs text-text-secondary">
                  Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ════════════════════════════════════════
            CREATE / EDIT PANEL — collapsible submenu
        ════════════════════════════════════════ */}
        {panelOpen && (
        <div className="order-1 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold text-text-primary">
                    {editingQuestion ? "Edit Question" : "Add Question"}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeAddPanel}
                  className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-border/50 hover:text-text-primary"
                  title={editingQuestion ? "Cancel edit" : "Close"}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>

            <CardContent>
              {/* Tab switcher */}
              <div className="mb-4 flex rounded-lg border border-border bg-background p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("single")}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    activeTab === "single"
                      ? "bg-primary text-white"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  Single Question
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("bulk")}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    activeTab === "bulk"
                      ? "bg-primary text-white"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  Bulk CSV
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("ai")}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    activeTab === "ai"
                      ? "bg-primary text-white"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  <span className="flex items-center justify-center gap-1">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI
                  </span>
                </button>
              </div>

              {activeTab === "single" && (
              <form onSubmit={handleFormSubmit} className="space-y-4">
                {/* Textbook → Chapter (cascading) */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLASS}>Textbook</label>
                    <select
                      value={formTextbookId}
                      onChange={(e) => {
                        setFormTextbookId(e.target.value);
                        setFormChapterId("");
                      }}
                      className={SELECT_CLASS}
                      disabled={!!editingQuestion}
                    >
                      <option value="">Select textbook…</option>
                      {textbooks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title} (Gr {t.grade})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>Chapter</label>
                    <select
                      value={formChapterId}
                      onChange={(e) => setFormChapterId(e.target.value)}
                      disabled={!formTextbookId || !!editingQuestion}
                      className={SELECT_CLASS}
                    >
                      <option value="">Select chapter…</option>
                      {formChapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          Ch {c.chapterNumber}: {c.title}
                        </option>
                      ))}
                    </select>
                    {editingQuestion && (
                      <p className="mt-1 text-xs text-text-muted">
                        Chapter cannot be changed.
                      </p>
                    )}
                  </div>
                </div>

                {/* Question text */}
                <div>
                  <label className={LABEL_CLASS}>Question Text</label>
                  <textarea
                    value={formQuestionText}
                    onChange={(e) => setFormQuestionText(e.target.value)}
                    placeholder="Enter the question…"
                    rows={3}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Options A–D */}
                <div>
                  <label className={LABEL_CLASS}>Answer Options</label>
                  <div className="space-y-2">
                    {formOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-6 text-center text-sm font-semibold text-text-secondary">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <Input
                          value={opt}
                          onChange={(e) => handleOptionChange(i, e.target.value)}
                          placeholder={`Option ${String.fromCharCode(65 + i)}${i < 2 ? " (required)" : " (optional)"}`}
                          className="flex-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Correct answer */}
                <div>
                  <label className={LABEL_CLASS}>Correct Answer</label>
                  <select
                    value={formCorrectAnswer}
                    onChange={(e) => setFormCorrectAnswer(e.target.value)}
                    className={SELECT_CLASS}
                    disabled={validOptions.length === 0}
                  >
                    <option value="">Select correct answer…</option>
                    {validOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Type + Difficulty row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLASS}>Type</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as QuestionType)}
                      className={SELECT_CLASS}
                    >
                      {TYPE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>Difficulty</label>
                    <div className="flex gap-2 pt-1">
                      {(["EASY", "MEDIUM", "HARD"] as Difficulty[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setFormDifficulty(d)}
                          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                            formDifficulty === d
                              ? d === "EASY"
                                ? "border-green-500 bg-green-50 text-green-700"
                                : d === "MEDIUM"
                                ? "border-yellow-500 bg-yellow-50 text-yellow-700"
                                : "border-red-500 bg-red-50 text-red-700"
                              : "border-border bg-surface text-text-secondary hover:bg-border/50"
                          }`}
                        >
                          {d[0] + d.slice(1).toLowerCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Explanation */}
                <div>
                  <label className={LABEL_CLASS}>
                    Explanation{" "}
                    <span className="font-normal text-text-muted">(optional)</span>
                  </label>
                  <textarea
                    value={formExplanation}
                    onChange={(e) => setFormExplanation(e.target.value)}
                    placeholder="Explain why the correct answer is correct…"
                    rows={3}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Video URL */}
                <div>
                  <label className={LABEL_CLASS}>
                    Video Explanation URL{" "}
                    <span className="font-normal text-text-muted">(optional)</span>
                  </label>
                  <input
                    type="url"
                    value={formVideoUrl}
                    onChange={(e) => setFormVideoUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=… or any video link"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    Paste a YouTube link or any public video URL. Students will see it after the quiz.
                  </p>
                </div>

                {/* Status messages */}
                {formError && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-error">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {formError}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <Button
                    type="submit"
                    className="flex-1"
                    isLoading={formSubmitting}
                    disabled={formSubmitting}
                  >
                    {editingQuestion ? "Update Question" : "Save Question"}
                  </Button>
                  {editingQuestion && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={clearForm}
                      disabled={formSubmitting}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
              )}

              {/* ── Bulk Import Panel ── */}
              {activeTab === "bulk" && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">
                    Upload a CSV file to import multiple questions at once.
                  </p>

                  {/* Template download */}
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Download className="h-4 w-4" />
                    Download CSV Template
                  </button>

                  {/* Textbook selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary">Textbook</label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      value={bulkTextbookId ?? ""}
                      onChange={(e) => {
                        setBulkTextbookId(e.target.value || null);
                        setBulkChapterId(null);
                      }}
                    >
                      <option value="">Select textbook…</option>
                      {textbooks.map((tb) => (
                        <option key={tb.id} value={tb.id}>
                          {tb.title} (Grade {tb.grade})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Chapter selection */}
                  {bulkTextbookId && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-secondary">Chapter</label>
                      <select
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={bulkChapterId ?? ""}
                        onChange={(e) => setBulkChapterId(e.target.value || null)}
                      >
                        <option value="">Select chapter…</option>
                        {(textbooks.find((t) => t.id === bulkTextbookId)?.chapters ?? []).map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            Ch. {ch.chapterNumber} — {ch.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* File input */}
                  <div>
                    <label className="text-xs font-medium text-text-secondary">CSV File</label>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="mt-1 w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-secondary file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary"
                      onChange={(e) => handleCsvFile(e.target.files?.[0] ?? null)}
                    />
                  </div>

                  {/* Preview table */}
                  {csvPreview.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-xs">
                        <tbody>
                          {csvPreview.map((row, i) => (
                            <tr key={i} className={i === 0 ? "bg-gray-50 font-semibold" : "border-t border-border"}>
                              {row.map((cell, j) => (
                                <td key={j} className="max-w-[120px] truncate px-2 py-1.5 text-text-secondary">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {csvPreview.length > 1 && (
                        <p className="px-2 py-1 text-xs text-text-muted">
                          Showing {csvPreview.length - 1} of preview rows (header + up to 5)
                        </p>
                      )}
                    </div>
                  )}

                  {/* Import result */}
                  {importResult && (
                    <div
                      className={cn(
                        "rounded-lg p-3 text-sm",
                        importResult.imported > 0 ? "bg-green-50 text-success" : "bg-red-50 text-error"
                      )}
                    >
                      {importResult.imported > 0 && (
                        <p>✓ Imported {importResult.imported} question{importResult.imported !== 1 ? "s" : ""}</p>
                      )}
                      {importResult.skipped > 0 && (
                        <p>⚠ Skipped {importResult.skipped} row{importResult.skipped !== 1 ? "s" : ""}</p>
                      )}
                      {importResult.errors.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {importResult.errors.slice(0, 5).map((e, i) => (
                            <li key={i}>Row {e.row}: {e.reason}</li>
                          ))}
                          {importResult.errors.length > 5 && (
                            <li>...and {importResult.errors.length - 5} more errors</li>
                          )}
                        </ul>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={handleImport}
                    disabled={!csvFile || !bulkChapterId || importing}
                    isLoading={importing}
                    className="w-full"
                  >
                    Import Questions
                  </Button>
                </div>
              )}

              {/* ── AI Generate Panel — Book-First Flow ── */}
              {activeTab === "ai" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium text-text-primary">AI Question Generation</p>
                    </div>
                    <p className="text-xs text-text-secondary">
                      Select a textbook with uploaded content, choose a chapter, and generate questions using AI.
                    </p>
                  </div>

                  {/* No textbooks at all */}
                  {textbooks.length === 0 && !loading && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
                      <p className="text-sm font-medium text-amber-800 mb-1">
                        No textbooks found
                      </p>
                      <p className="text-xs text-amber-700 mb-3">
                        Add a textbook first from the{" "}
                        <a href={`${basePath}/textbooks`} className="font-medium underline hover:text-amber-900">
                          Textbook Management
                        </a>{" "}
                        page, then come back here to generate questions.
                      </p>
                    </div>
                  )}

                  {/* Step 1: Select Textbook */}
                  {textbooks.length > 0 && (
                    <div>
                      <label className={LABEL_CLASS}>Step 1: Select Textbook</label>
                      <select
                        value={aiTextbookId}
                        onChange={(e) => handleAiTextbookChange(e.target.value)}
                        className={SELECT_CLASS}
                      >
                        <option value="">Select textbook…</option>
                        {textbooks.map((tb) => (
                          <option key={tb.id} value={tb.id}>
                            {tb.title} — {tb.subject}, Gr {tb.grade}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Step 2: Select Chapter */}
                  {aiTextbookId && (
                    <div>
                      <label className={LABEL_CLASS}>Step 2: Select Chapter</label>
                      {aiChapters.length === 0 ? (
                        <p className="rounded-lg bg-background p-3 text-sm text-text-secondary">
                          No chapters found. Add chapters via the{" "}
                          <a href={`${basePath}/textbooks`} className="font-medium text-primary underline">
                            Textbook Management
                          </a>{" "}
                          page.
                        </p>
                      ) : (
                        <select
                          value={aiChapterId}
                          onChange={(e) => {
                            setAiChapterId(e.target.value);
                            setAiQuestions([]);
                            setAiError(null);
                          }}
                          className={SELECT_CLASS}
                        >
                          <option value="">Select chapter…</option>
                          <option value="all">All Chapters (Cumulative)</option>
                          {aiChapters.map((ch) => (
                            <option key={ch.id} value={ch.id}>
                              Ch {ch.chapterNumber}: {ch.title}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {/* Step 3: Generation Settings */}
                  {aiTextbookId && aiChapterId && (
                    <>
                      <div className="rounded-lg border border-border p-3 space-y-3">
                        <h4 className="text-sm font-medium text-text-primary">Step 3: Generation Settings</h4>
                        <div className="space-y-1.5 pt-1">
                          <label className="text-xs font-medium text-text-secondary">Question Types</label>
                          <div className="flex flex-wrap gap-2">
                            {TYPE_OPTIONS.map((type) => {
                              const isSelected = aiQuestionTypes.includes(type.value);
                              return (
                                <button
                                  key={type.value}
                                  type="button"
                                  onClick={() => {
                                    if (isSelected) {
                                      setAiQuestionTypes(prev => prev.filter(t => t !== type.value));
                                    } else {
                                      setAiQuestionTypes(prev => [...prev, type.value]);
                                    }
                                  }}
                                  className={cn(
                                    "rounded-full border px-3 py-1 text-xs font-medium transition-all",
                                    isSelected
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-border bg-surface text-text-secondary hover:border-primary/40"
                                  )}
                                >
                                  {type.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-secondary">Count</label>
                            <input
                              type="number"
                              min={1}
                              max={30}
                              value={aiCount}
                              onChange={(e) => setAiCount(Number(e.target.value) || 10)}
                              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-secondary">Difficulty</label>
                            <select
                              value={aiDifficulty}
                              onChange={(e) => setAiDifficulty(e.target.value)}
                              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                            >
                              <option value="MIXED">Mixed</option>
                              <option value="EASY">Easy</option>
                              <option value="MEDIUM">Medium</option>
                              <option value="HARD">Hard</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <Button
                        type="button"
                        className="w-full"
                        isLoading={aiGenerating}
                        onClick={handleAiGenerate}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        {aiGenerating ? "Generating…" : "Generate Questions"}
                      </Button>
                    </>
                  )}

                  {/* Error */}
                  {aiError && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-error">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {aiError}
                    </div>
                  )}

                  {/* Generated questions preview */}
                  {aiQuestions.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-text-primary">
                          {aiQuestions.filter((q) => q._selected).length}/{aiQuestions.length} selected
                        </h4>
                        <div className="flex gap-2 text-xs">
                          <button type="button" onClick={() => setAiQuestions((p) => p.map((q) => ({ ...q, _selected: true })))} className="text-primary hover:underline">All</button>
                          <button type="button" onClick={() => setAiQuestions((p) => p.map((q) => ({ ...q, _selected: false })))} className="text-primary hover:underline">None</button>
                        </div>
                      </div>

                      <div className="max-h-[400px] overflow-y-auto space-y-2">
                        {aiQuestions.map((q, i) => (
                          <div
                            key={i}
                            className={cn(
                              "rounded-lg border p-3 text-sm",
                              q._selected ? "border-primary/30 bg-primary/5" : "border-border opacity-60"
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={q._selected}
                                onChange={() => setAiQuestions((p) => p.map((qq, j) => j === i ? { ...qq, _selected: !qq._selected } : qq))}
                                className="mt-1 h-4 w-4 rounded border-border text-primary"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <span className="font-medium">Q{i + 1}.</span>
                                  <Badge variant={q.difficulty === "EASY" ? "success" : q.difficulty === "HARD" ? "error" : "warning"}>
                                    {q.difficulty}
                                  </Badge>
                                  {aiNeedsReview(q) ? (
                                    <Badge
                                      variant="warning"
                                      title={
                                        q.qualityDetails && Object.keys(q.qualityDetails).length > 0
                                          ? Object.values(q.qualityDetails).join(" · ")
                                          : (q.qualityFlags ?? []).join(", ")
                                      }
                                    >
                                      ⚠ Needs review
                                    </Badge>
                                  ) : (
                                    <Badge variant="success">✓ Verified</Badge>
                                  )}
                                </div>
                                <p className="text-text-primary mb-1">{q.questionText}</p>
                                <div className="grid grid-cols-2 gap-1">
                                  {q.options.map((opt, oi) => (
                                    <div key={oi} className={cn("rounded px-2 py-0.5 text-xs", opt === q.correctAnswer ? "bg-green-100 text-green-800 font-medium" : "bg-background text-text-secondary")}>
                                      {String.fromCharCode(65 + oi)}. {opt}
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <button type="button" onClick={() => setAiQuestions((p) => p.filter((_, j) => j !== i))} className="shrink-0 p-1 text-text-muted hover:text-red-600">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-3">
                        <Button type="button" variant="outline" className="flex-1" onClick={handleAiGenerate} disabled={aiGenerating}>
                          Regenerate
                        </Button>
                        <Button
                          type="button"
                          className="flex-1"
                          isLoading={aiSaving}
                          disabled={aiSaving || aiQuestions.filter((q) => q._selected).length === 0}
                          onClick={handleAiSaveQuestions}
                        >
                          <Check className="mr-2 h-4 w-4" />
                          Save {aiQuestions.filter((q) => q._selected).length}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        )}
      </div>
    </div>
  );
}
