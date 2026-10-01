"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useAdminBasePath } from "@/hooks/use-admin-base-path";
import {
  HelpCircle,
  Plus,
  Search,
  X,
  XCircle,
  RotateCw,
  SlidersHorizontal,
  Download,
  Sparkles,
  Check,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { useEntitlements } from "@/hooks/use-entitlements";
import Papa from "papaparse";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/ui/math-text";
import { normalizeMathText } from "@/lib/math-notation";
import {
  DIFFICULTY_STYLE,
  Pagination,
  QuestionListSkeleton,
  QuestionRow,
  StatsStrip,
  type Difficulty,
  type QuestionStats,
  type QuestionType,
} from "@/components/admin/question-bank-ui";

// ─── Types ────────────────────────────────────────────────

interface TextbookChapter {
  id: string;
  title: string;
  chapterNumber: number;
  /** Retrieval chunks stored for this chapter. 0 = not processed yet. */
  chunkCount: number;
}

interface TextbookOption {
  id: string;
  title: string;
  subject: string;
  grade: number;
  hasContent: boolean;
  contentLength: number;
  chunkingStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  /** National-library book (no owning school). */
  isLibrary: boolean;
  /** Whether this admin may add/edit questions in it. */
  canManage: boolean;
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
  /** Real quiz answers recorded against this question. */
  answerCount: number;
  accuracy: number | null;
  canManage: boolean;
  language: string;
  createdAt: string;
  /** DRAFT = hidden from students until published. */
  status: "DRAFT" | "PUBLISHED";
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
  stats: QuestionStats;
  /** Omitted when requested with textbooks=0. */
  textbooks?: TextbookOption[];
}

// ─── Constants ────────────────────────────────────────────

const DIFFICULTY_OPTIONS: (Difficulty | "ALL")[] = ["ALL", "EASY", "MEDIUM", "HARD"];

type SortKey = "newest" | "oldest" | "mostUsed" | "leastUsed";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "mostUsed", label: "Most answered" },
  { value: "leastUsed", label: "Least answered" },
];

const PAGE_SIZE = 20;

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "MCQ", label: "Multiple Choice" },
  { value: "TRUE_FALSE", label: "True / False" },
  { value: "FILL_IN_BLANK", label: "Fill in the Blank" },
  { value: "MATCH_PAIRS", label: "Match Pairs" },
  { value: "ORDERING", label: "Ordering" },
];

const FILTER_SELECT_CLASS =
  "h-9 min-w-0 rounded-lg border border-border bg-surface px-2.5 text-sm text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50";

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
  // A repeat of a question the chapter already has — never pre-selected.
  "DUPLICATE_EXISTING",
  // Needs a formula/constant the chapter never states.
  "OUT_OF_SCOPE",
  // A wrong option no student would pick, so the question is really 3-option.
  "WEAK_DISTRACTOR",
  "FACTUAL_ERROR",
  "LOW_RELEVANCE",
]);

function aiNeedsReview(q: { qualityVerified?: boolean; qualityFlags?: string[] }): boolean {
  if (q.qualityVerified === false) return true;
  return (q.qualityFlags ?? []).some((f) => REVIEW_FLAGS.has(f));
}

// Draft key so a page reload (Fast Refresh, session refresh, accidental nav)
// doesn't lose a batch of AI-generated questions the admin is still reviewing.
const AI_DRAFT_KEY = "abugida:admin:ai-draft:v1";

// ─── Main Component ───────────────────────────────────────

export default function AdminQuestionsPage() {
  const t = useTranslations("admin");
  const basePath = useAdminBasePath();
  const ent = useEntitlements();
  const aiGenEnabled = ent.aiFeatures.aiQuizGen;

  // ── Filter state ─────────────────────────────────────────
  const [filterTextbookId, setFilterTextbookId] = useState("");
  const [filterChapterId, setFilterChapterId] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | "ALL">("ALL");
  const [filterType, setFilterType] = useState<QuestionType | "">("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  // Show only drafts (imported/generated questions students can't see yet).
  const [draftsOnly, setDraftsOnly] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishingAll, setPublishingAll] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Data state ───────────────────────────────────────────
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [textbooks, setTextbooks] = useState<TextbookOption[]>([]);
  const [stats, setStats] = useState<QuestionStats | null>(null);
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
    duplicates?: number;
    status?: "DRAFT" | "PUBLISHED";
    errors: { row: number; reason: string }[];
  } | null>(null);
  // Off by default: questions written outside Abugida haven't had their
  // answers checked, so they wait as drafts for review.
  const [importPublish, setImportPublish] = useState(false);
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Textbooks (with chapter chunk counts) only need loading once — later
  // page/filter fetches skip them unless the admin hits Refresh.
  const textbooksLoaded = useRef(false);
  // Drops responses from superseded requests when filters change quickly.
  const requestSeq = useRef(0);
  const draftHydrated = useRef(false);

  // If AI question generation is turned off platform-wide, never sit on the AI tab.
  useEffect(() => {
    if (!aiGenEnabled && activeTab === "ai") setActiveTab("single");
  }, [aiGenEnabled, activeTab]);

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

  // Library books are read-only to school admins, so every "add questions"
  // picker (single, CSV, AI) only offers books this admin may change.
  const manageableTextbooks = textbooks.filter((tb) => tb.canManage);
  const libraryTextbooks = textbooks.filter((tb) => tb.isLibrary);
  const schoolTextbooks = textbooks.filter((tb) => !tb.isLibrary);

  // ── Derived: chapters for form dropdown ─────────────────
  const formChapters =
    textbooks.find((t) => t.id === formTextbookId)?.chapters ?? [];

  // ── Derived: valid options for correct answer dropdown ───
  const validOptions = formOptions.filter((o) => o.trim() !== "");

  // ─── Fetch questions ─────────────────────────────────────

  const fetchQuestions = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (filterTextbookId) params.set("textbookId", filterTextbookId);
      if (filterChapterId) params.set("chapterId", filterChapterId);
      if (filterDifficulty !== "ALL") params.set("difficulty", filterDifficulty);
      if (filterType) params.set("type", filterType);
      if (unusedOnly) params.set("unused", "1");
      if (draftsOnly) params.set("status", "DRAFT");
      if (search) params.set("search", search);
      params.set("sort", sort);
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      if (textbooksLoaded.current) params.set("textbooks", "0");

      const res = await fetch(`/api/admin/questions?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load questions");
      const data: FetchResult = await res.json();
      if (seq !== requestSeq.current) return;
      setQuestions(data.questions ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setStats(data.stats ?? null);
      if (data.textbooks) {
        setTextbooks(data.textbooks);
        textbooksLoaded.current = true;
      }
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filterTextbookId, filterChapterId, filterDifficulty, filterType, unusedOnly, draftsOnly, search, sort, page]);

  function refreshAll() {
    textbooksLoaded.current = false;
    fetchQuestions();
  }

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  // Clear any pending debounce on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // "/" jumps to search, like most dashboards.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  const hasActiveFilters =
    !!filterTextbookId || !!filterChapterId || filterDifficulty !== "ALL" || !!filterType || unusedOnly || draftsOnly || !!search;

  function clearFilters() {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setFilterTextbookId("");
    setFilterChapterId("");
    setFilterDifficulty("ALL");
    setFilterType("");
    setUnusedOnly(false);
    setDraftsOnly(false);
    setSearchInput("");
    setSearch("");
    setPage(1);
  }

  function goToPage(p: number) {
    setPage(p);
    setExpandedId(null);
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
      if (editingQuestion?.id === id) clearForm();
      toast.success("Question deleted.");
      // Refetch so the page backfills and the stats stay honest.
      await fetchQuestions();
    } catch {
      toast.error("Failed to delete question.");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  // ─── Publish drafts ───────────────────────────────────────

  async function handlePublish(id: string) {
    setPublishingId(id);
    try {
      const res = await fetch(`/api/admin/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PUBLISHED" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Question published. Students can now get it in quizzes.");
      await fetchQuestions();
    } catch {
      toast.error("Couldn't publish the question.");
    } finally {
      setPublishingId(null);
    }
  }

  /** Publish every draft the current filters show (difficulty aside). */
  async function handlePublishAll() {
    setPublishingAll(true);
    try {
      const res = await fetch("/api/admin/questions/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textbookId: filterTextbookId || undefined,
          chapterId: filterChapterId || undefined,
          type: filterType || undefined,
          search: search || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error);
      toast.success(`Published ${data.published} question${data.published === 1 ? "" : "s"}.`);
      await fetchQuestions();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't publish the drafts.");
    } finally {
      setPublishingAll(false);
    }
  }

  /** Jump the bank to the drafts an import just created. */
  function reviewImportedDrafts() {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setFilterTextbookId(bulkTextbookId ?? "");
    setFilterChapterId(bulkChapterId ?? "");
    setFilterDifficulty("ALL");
    setFilterType("");
    setUnusedOnly(false);
    setDraftsOnly(true);
    setSearchInput("");
    setSearch("");
    setPage(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    // correctAnswer may be the option's text or its letter (A–D).
    const examples = [
      "What is the powerhouse of the cell?,Nucleus,Mitochondria,Ribosome,Cell wall,Mitochondria,EASY,Mitochondria produce ATP energy",
      "What is the SI unit of force?,Joule,Newton,Watt,Pascal,B,EASY,Force is measured in newtons (N)",
    ];
    const csv = `${headers}\n${examples.join("\n")}\n`;
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
      if (importPublish) fd.append("publish", "1");
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

  // ── "Generating before processing" warning ───────────────────────────────
  // Question generation samples chunks spread across the whole chapter. Chunks
  // are only written by the textbook processing pipeline, so before it has run
  // there are none and generation silently falls back to the chapter's opening
  // ~30,000 characters — the back of a long chapter never produces a question,
  // and because the rotation offset only applies to the chunk sampler, running
  // it again re-mines the identical text and the duplicate filter throws more
  // of it away each time.
  const aiSelectedChapter = aiChapters.find((c) => c.id === aiChapterId);
  const aiChapterUnprocessed = !!aiSelectedChapter && aiSelectedChapter.chunkCount === 0;
  // "All Chapters" concatenates raw chapter text and never consults chunks at
  // all, so processing does not change its behaviour — it gets its own note
  // rather than a warning that would wrongly imply processing would help.
  const aiCumulative = aiChapterId === "all";
  const aiProcessing = aiSelectedTb?.chunkingStatus === "PROCESSING";

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

  const showSkeleton = loading && !fetchError;
  const diffCount = (d: Difficulty | "ALL") =>
    stats ? (d === "ALL" ? stats.total : stats.byDifficulty[d]) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
            <HelpCircle className="h-6 w-6 text-primary" />
            {t("questionsTitle")}
          </h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            Browse, review and manage the quiz question bank across every textbook.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={loading}
            className="gap-1.5"
            title="Refresh"
          >
            <RotateCw className={cn("h-4 w-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            onClick={() => (panelOpen ? closeAddPanel() : openAddPanel())}
            variant={panelOpen ? "outline" : "primary"}
            size="sm"
            className="shrink-0 gap-1.5"
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
      </div>

      <div className="flex flex-col gap-5">
        {/* ════════════════════════════════════════
            STATS + FILTERS + QUESTION LIST
        ════════════════════════════════════════ */}
        <div className="order-2 flex flex-col gap-4">
          <StatsStrip stats={stats} />

          <Card className="overflow-hidden">
            {/* Toolbar */}
            <div className="space-y-3 border-b border-border p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search question text…"
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-16 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:bg-surface focus:ring-1 focus:ring-primary"
                  />
                  {searchInput ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
                        setSearchInput("");
                        setSearch("");
                        setPage(1);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:text-text-primary"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : (
                    <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface px-1.5 text-[11px] text-text-muted sm:block">
                      /
                    </kbd>
                  )}
                </div>
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as SortKey);
                    goToPage(1);
                  }}
                  className={cn(FILTER_SELECT_CLASS, "h-10 sm:w-44")}
                  aria-label="Sort"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <SlidersHorizontal className="hidden h-4 w-4 shrink-0 text-text-muted sm:block" />
                <select
                  value={filterTextbookId}
                  onChange={(e) => handleFilterTextbookChange(e.target.value)}
                  className={cn(FILTER_SELECT_CLASS, "col-span-2 sm:w-64")}
                  aria-label="Textbook"
                >
                  <option value="">All textbooks</option>
                  {libraryTextbooks.length > 0 && schoolTextbooks.length > 0 ? (
                    <>
                      <optgroup label="National library">
                        {libraryTextbooks.map((tb) => (
                          <option key={tb.id} value={tb.id}>
                            {tb.title} (Gr {tb.grade})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="School uploads">
                        {schoolTextbooks.map((tb) => (
                          <option key={tb.id} value={tb.id}>
                            {tb.title} (Gr {tb.grade})
                          </option>
                        ))}
                      </optgroup>
                    </>
                  ) : (
                    textbooks.map((tb) => (
                      <option key={tb.id} value={tb.id}>
                        {tb.title} (Gr {tb.grade})
                      </option>
                    ))
                  )}
                </select>
                <select
                  value={filterChapterId}
                  onChange={(e) => handleFilterChapterChange(e.target.value)}
                  disabled={!filterTextbookId}
                  className={cn(FILTER_SELECT_CLASS, "col-span-2 sm:w-64")}
                  aria-label="Chapter"
                  title={filterTextbookId ? undefined : "Pick a textbook first"}
                >
                  <option value="">All chapters</option>
                  {filterChapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      Ch {c.chapterNumber}: {c.title}
                    </option>
                  ))}
                </select>
                <select
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value as QuestionType | "");
                    goToPage(1);
                  }}
                  className={FILTER_SELECT_CLASS}
                  aria-label="Question type"
                >
                  <option value="">All types</option>
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setUnusedOnly((v) => !v);
                    goToPage(1);
                  }}
                  aria-pressed={unusedOnly}
                  className={cn(
                    "h-9 rounded-lg border px-3 text-sm font-medium transition-colors",
                    unusedOnly
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-secondary hover:border-primary/40 hover:text-text-primary",
                  )}
                >
                  Never answered
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftsOnly((v) => !v);
                    goToPage(1);
                  }}
                  aria-pressed={draftsOnly}
                  title="Questions students can't see until you publish them"
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
                    draftsOnly
                      ? "border-warning bg-warning/10 text-warning"
                      : "border-border text-text-secondary hover:border-warning/40 hover:text-text-primary",
                  )}
                >
                  Drafts
                  {!!stats?.drafts && (
                    <span className="rounded-full bg-warning/15 px-1.5 text-xs tabular-nums text-warning">
                      {stats.drafts}
                    </span>
                  )}
                </button>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="col-span-2 text-left text-sm font-medium text-primary hover:underline sm:ml-auto"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {/* Difficulty tabs with live counts */}
              <div className="flex gap-1 overflow-x-auto rounded-lg bg-background p-1">
                {DIFFICULTY_OPTIONS.map((d) => {
                  const active = filterDifficulty === d;
                  const count = diffCount(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleFilterDifficultyChange(d)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-surface text-text-primary shadow-sm"
                          : "text-text-secondary hover:text-text-primary",
                      )}
                    >
                      {d !== "ALL" && (
                        <span className={cn("h-2 w-2 rounded-full", DIFFICULTY_STYLE[d].dot)} />
                      )}
                      {d === "ALL" ? "All" : DIFFICULTY_STYLE[d].label}
                      {count == null ? (
                        <span className="h-4 w-6 animate-pulse rounded bg-border/60" />
                      ) : (
                        <span
                          className={cn(
                            "rounded-full px-1.5 text-xs tabular-nums",
                            active ? "bg-primary/10 text-primary" : "bg-border/50 text-text-muted",
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Drafts waiting for review */}
            {draftsOnly && !!stats?.drafts && !fetchError && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-warning/5 px-4 py-3">
                <p className="text-sm text-text-secondary">
                  <span className="font-semibold text-text-primary">
                    {stats.drafts.toLocaleString()} draft{stats.drafts === 1 ? "" : "s"}
                  </span>{" "}
                  {stats.drafts === 1 ? "is" : "are"} hidden from students. Open each one to check the answer, then
                  publish.
                </p>
                <Button size="sm" onClick={handlePublishAll} isLoading={publishingAll} className="gap-1.5">
                  <Check className="h-4 w-4" /> Publish all {stats.drafts.toLocaleString()}
                </Button>
              </div>
            )}

            {/* Question list */}
            <div>
              {showSkeleton ? (
                <QuestionListSkeleton rows={questions.length > 0 ? Math.min(questions.length, 8) : 8} />
              ) : fetchError ? (
                <div className="flex flex-col items-center gap-3 py-14">
                  <XCircle className="h-9 w-9 text-error" />
                  <p className="text-sm text-text-secondary">{fetchError}</p>
                  <Button variant="outline" size="sm" onClick={fetchQuestions}>
                    Try Again
                  </Button>
                </div>
              ) : questions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
                  <div className="mb-1 rounded-full bg-primary/10 p-3">
                    <Search className="h-6 w-6 text-primary" />
                  </div>
                  <p className="font-medium text-text-primary">No questions match</p>
                  <p className="max-w-sm text-sm text-text-secondary">
                    {hasActiveFilters
                      ? "Try widening your filters or searching for something else."
                      : "The bank is empty. Add a question, import a CSV, or generate a batch with AI."}
                  </p>
                  <div className="mt-2 flex gap-2">
                    {hasActiveFilters && (
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    )}
                    <Button size="sm" onClick={openAddPanel} className="gap-1.5">
                      <Plus className="h-4 w-4" /> Add Question
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {questions.map((q) => (
                    <QuestionRow
                      key={q.id}
                      q={q}
                      expanded={expandedId === q.id}
                      isEditing={editingQuestion?.id === q.id}
                      isConfirming={confirmDeleteId === q.id}
                      isDeleting={deletingId === q.id}
                      onToggle={() => setExpandedId((cur) => (cur === q.id ? null : q.id))}
                      onEdit={() => {
                        if (!q.canManage) return;
                        if (editingQuestion?.id === q.id) {
                          clearForm();
                        } else {
                          startEdit(q);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }
                      }}
                      onAskDelete={() => setConfirmDeleteId(q.id)}
                      onCancelDelete={() => setConfirmDeleteId(null)}
                      onDelete={() => handleDelete(q.id)}
                      isPublishing={publishingId === q.id}
                      onPublish={() => handlePublish(q.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {!fetchError && total > 0 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={PAGE_SIZE}
                disabled={loading}
                onPage={goToPage}
              />
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
              {textbooks.length > 0 && manageableTextbooks.length === 0 && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2.5 text-sm text-text-secondary">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                  <span>
                    National library questions are managed by the platform and shared with every school.
                    To add your own questions, first upload a textbook your school uses that isn&apos;t in the library.
                  </span>
                </div>
              )}
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
                {aiGenEnabled && (
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
                )}
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
                      {manageableTextbooks.map((t) => (
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
                        {/* A <select> cannot render maths — show Unicode. */}
                        {normalizeMathText(opt)}
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
                    Upload a CSV of multiple-choice questions for one chapter. The correct answer can be the
                    option&apos;s text or its letter (A–D). Questions the chapter already has are skipped.
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
                      {manageableTextbooks.map((tb) => (
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

                  <label htmlFor="import-publish" className="flex items-start gap-2 text-sm text-text-secondary">
                    <input
                      id="import-publish"
                      type="checkbox"
                      className="mt-0.5"
                      checked={importPublish}
                      onChange={(e) => setImportPublish(e.target.checked)}
                    />
                    <span>
                      Publish immediately
                      <span className="block text-xs text-text-muted">
                        Off: questions are saved as drafts, hidden from students until you check and publish them.
                      </span>
                    </span>
                  </label>

                  {/* Import result */}
                  {importResult && (
                    <div
                      className={cn(
                        "rounded-lg p-3 text-sm",
                        importResult.imported > 0 ? "bg-green-50 text-success" : "bg-red-50 text-error"
                      )}
                    >
                      {importResult.imported > 0 && (
                        <p>
                          ✓ Imported {importResult.imported} question{importResult.imported !== 1 ? "s" : ""}
                          {importResult.status === "DRAFT" ? " as drafts" : ""}
                        </p>
                      )}
                      {!!importResult.duplicates && (
                        <p>
                          ↺ Skipped {importResult.duplicates} repeat{importResult.duplicates !== 1 ? "s" : ""} of
                          questions the chapter already has
                        </p>
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
                      {importResult.status === "DRAFT" && importResult.imported > 0 && (
                        <Button size="sm" variant="outline" className="mt-2" onClick={reviewImportedDrafts}>
                          Review the drafts
                        </Button>
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
              {activeTab === "ai" && aiGenEnabled && (
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
                        {manageableTextbooks.map((tb) => (
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

                      {/* Unprocessed chapter — generation degrades to a raw slice. */}
                      {aiChapterUnprocessed && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          <div className="space-y-1">
                            <p className="font-semibold">
                              {aiProcessing
                                ? "This textbook is still processing"
                                : "This chapter hasn't been processed yet"}
                            </p>
                            <p>
                              Questions will be drawn only from the chapter&apos;s first
                              ~30,000 characters, so the rest of it can&apos;t be used — and
                              generating again re-reads the same text instead of moving
                              through the chapter, so repeat runs return more duplicates and
                              fewer usable questions.
                            </p>
                            <p>
                              {aiProcessing ? (
                                <>Wait for processing to finish, then generate.</>
                              ) : (
                                <>
                                  Run <span className="font-medium">Process</span> on this book
                                  in{" "}
                                  <a
                                    href={`${basePath}/textbooks`}
                                    className="font-medium underline"
                                  >
                                    Textbook Management
                                  </a>{" "}
                                  first for full-chapter coverage. You can still generate now
                                  if you want.
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Cumulative mode never uses chunks, processed or not. */}
                      {aiCumulative && (
                        <div className="flex items-start gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm text-text-secondary">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                          <p>
                            <span className="font-medium text-text-primary">
                              All Chapters
                            </span>{" "}
                            joins every chapter&apos;s raw text and uses the first ~80,000
                            characters. It doesn&apos;t sample across chapters even after
                            processing, so pick a single chapter for the best coverage.
                          </p>
                        </div>
                      )}

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
                                <p className="text-text-primary mb-1"><MathText text={q.questionText} /></p>
                                <div className="grid grid-cols-2 gap-1">
                                  {q.options.map((opt, oi) => (
                                    <div key={oi} className={cn("rounded px-2 py-0.5 text-xs", opt === q.correctAnswer ? "bg-green-100 text-green-800 font-medium" : "bg-background text-text-secondary")}>
                                      {String.fromCharCode(65 + oi)}. <MathText text={opt} />
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
