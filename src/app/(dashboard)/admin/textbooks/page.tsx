"use client";

import { useEffect, useState, useCallback } from "react";
import { BookOpen, Trash2, Plus, FileJson, FileText, ChevronDown, ChevronUp, XCircle, AlertCircle, CheckCircle, Sparkles, Check, X, Upload, Edit3 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";

// ─── Types ────────────────────────────────────────────────

interface TextbookListItem {
  id: string;
  title: string;
  subject: string;
  grade: number;
  processingStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  createdAt: string;
  hasContent: boolean;
  contentLength: number;
  _count: { chapters: number };
  chapters: { id: string; title: string; chapterNumber: number; _count: { questions: number } }[];
}

interface AIGeneratedQuestion {
  questionText: string;
  type: "MCQ" | "TRUE_FALSE";
  options: string[];
  correctAnswer: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  explanation: string;
  _selected?: boolean;
}

interface QuestionInput {
  question: string;
  options: [string, string, string, string];
  correctAnswer: string;
  explanation: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
}

interface ChapterInput {
  title: string;
  orderIndex: number;
  questions: QuestionInput[];
}

interface JsonImportData {
  title: string;
  subject: string;
  grade: number;
  chapters: ChapterInput[];
}

// AI detected chapter from create-with-ai endpoint
interface DetectedChapter {
  chapterNumber: number;
  title: string;
  contentPreview: string;
  contentLength: number;
  content: string;
  _selected: boolean;
  _editing: boolean;
}

// ─── Constants ────────────────────────────────────────────

const SUBJECTS = [
  "Biology",
  "Mathematics",
  "Physics",
  "Chemistry",
  "English",
  "History",
  "Geography",
  "Civics",
  "Amharic",
  "ICT",
];

const JSON_EXAMPLE = `{
  "title": "Grade 9 Physics",
  "subject": "Physics",
  "grade": 9,
  "chapters": [
    {
      "title": "Chapter 1: Motion",
      "orderIndex": 1,
      "questions": [
        {
          "question": "What is velocity?",
          "options": ["Speed only", "Speed with direction", "Distance", "Acceleration"],
          "correctAnswer": "Speed with direction",
          "explanation": "Velocity is a vector quantity...",
          "difficulty": "EASY"
        }
      ]
    }
  ]
}`;

const STATUS_CONFIG: Record<
  TextbookListItem["processingStatus"],
  { label: string; variant: "success" | "warning" | "error" | "default" | "info" }
> = {
  COMPLETED: { label: "Ready", variant: "success" },
  PENDING: { label: "Pending", variant: "warning" },
  PROCESSING: { label: "Processing", variant: "info" },
  FAILED: { label: "Failed", variant: "error" },
};

// ─── Helper: count total questions ────────────────────────

function totalQuestions(textbook: TextbookListItem): number {
  return textbook.chapters.reduce((sum, ch) => sum + ch._count.questions, 0);
}

// ─── Main Component ───────────────────────────────────────

export default function AdminTextbooksPage() {
  const [textbooks, setTextbooks] = useState<TextbookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"simple" | "json" | "ai">("ai");

  // Simple form state
  const [simpleTitle, setSimpleTitle] = useState("");
  const [simpleSubject, setSimpleSubject] = useState("");
  const [simpleGrade, setSimpleGrade] = useState("");
  const [simpleChapterTitles, setSimpleChapterTitles] = useState("");
  const [simpleSubmitting, setSimpleSubmitting] = useState(false);
  const [simpleError, setSimpleError] = useState<string | null>(null);

  // JSON import state
  const [jsonText, setJsonText] = useState("");
  const [jsonValidation, setJsonValidation] = useState<{
    valid: boolean;
    message: string;
    questionCount?: number;
    chapterCount?: number;
  } | null>(null);
  const [jsonSubmitting, setJsonSubmitting] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  // AI Upload state — unified form + chapter detection
  const [aiTitle, setAiTitle] = useState("");
  const [aiSubject, setAiSubject] = useState("");
  const [aiGrade, setAiGrade] = useState("");
  const [aiPublisher, setAiPublisher] = useState("");
  const [aiAcademicYear, setAiAcademicYear] = useState("");
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiDetecting, setAiDetecting] = useState(false);
  const [aiDetectedChapters, setAiDetectedChapters] = useState<DetectedChapter[]>([]);
  const [aiExtractedInfo, setAiExtractedInfo] = useState<{
    contentLength: number;
    wordCount: number;
    pageCount?: number;
    fullText: string;
  } | null>(null);
  const [aiCreating, setAiCreating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Fetch textbooks ──────────────────────────────────────

  const fetchTextbooks = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/admin/textbooks");
      if (!res.ok) throw new Error("Failed to load textbooks");
      const data = await res.json();
      setTextbooks(data.textbooks ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTextbooks();
  }, [fetchTextbooks]);

  // ── Delete ───────────────────────────────────────────────

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/textbooks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setTextbooks((prev) => prev.filter((t) => t.id !== id));
      toast.success("Textbook deleted.");
    } catch {
      toast.error("Failed to delete textbook.");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  // ── Simple Form Submit ───────────────────────────────────

  async function handleSimpleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSimpleError(null);

    if (!simpleTitle.trim()) {
      setSimpleError("Title is required.");
      return;
    }
    if (!simpleSubject) {
      setSimpleError("Subject is required.");
      return;
    }
    if (!simpleGrade) {
      setSimpleError("Grade is required.");
      return;
    }

    const chapterTitles = simpleChapterTitles
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);

    const chapters: ChapterInput[] = chapterTitles.map((title, index) => ({
      title,
      orderIndex: index + 1,
      questions: [],
    }));

    setSimpleSubmitting(true);
    try {
      const res = await fetch("/api/admin/textbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: simpleTitle.trim(),
          subject: simpleSubject,
          grade: parseInt(simpleGrade, 10),
          chapters,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create textbook");
      }

      toast.success("Textbook created successfully!");
      setSimpleTitle("");
      setSimpleSubject("");
      setSimpleGrade("");
      setSimpleChapterTitles("");
      await fetchTextbooks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSimpleSubmitting(false);
    }
  }

  // ── JSON Validate ────────────────────────────────────────

  function handleValidateJson() {
    setJsonValidation(null);
    if (!jsonText.trim()) {
      setJsonValidation({ valid: false, message: "Please paste JSON content first." });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setJsonValidation({ valid: false, message: "Invalid JSON — could not parse." });
      return;
    }

    const data = parsed as Partial<JsonImportData>;

    if (!data.title || typeof data.title !== "string") {
      setJsonValidation({ valid: false, message: 'Missing or invalid "title" field.' });
      return;
    }
    if (!data.subject || typeof data.subject !== "string") {
      setJsonValidation({ valid: false, message: 'Missing or invalid "subject" field.' });
      return;
    }
    if (typeof data.grade !== "number") {
      setJsonValidation({ valid: false, message: 'Missing or invalid "grade" field (must be a number).' });
      return;
    }
    if (!Array.isArray(data.chapters)) {
      setJsonValidation({ valid: false, message: '"chapters" must be an array.' });
      return;
    }

    let totalQ = 0;
    for (let i = 0; i < data.chapters.length; i++) {
      const ch = data.chapters[i];
      if (!ch.title || typeof ch.title !== "string") {
        setJsonValidation({ valid: false, message: `Chapter ${i + 1} is missing a "title".` });
        return;
      }
      if (!Array.isArray(ch.questions)) {
        setJsonValidation({ valid: false, message: `Chapter "${ch.title}" — "questions" must be an array.` });
        return;
      }
      for (let j = 0; j < ch.questions.length; j++) {
        const q = ch.questions[j];
        if (!q.question || typeof q.question !== "string") {
          setJsonValidation({
            valid: false,
            message: `Chapter "${ch.title}", question ${j + 1}: missing "question" text.`,
          });
          return;
        }
        if (!Array.isArray(q.options) || q.options.length < 2) {
          setJsonValidation({
            valid: false,
            message: `Chapter "${ch.title}", question ${j + 1}: "options" must be an array with at least 2 items.`,
          });
          return;
        }
        if (!q.correctAnswer) {
          setJsonValidation({
            valid: false,
            message: `Chapter "${ch.title}", question ${j + 1}: missing "correctAnswer".`,
          });
          return;
        }
        totalQ++;
      }
    }

    setJsonValidation({
      valid: true,
      message: `Valid JSON — ${data.chapters.length} chapter${data.chapters.length !== 1 ? "s" : ""}, ${totalQ} question${totalQ !== 1 ? "s" : ""}.`,
      chapterCount: data.chapters.length,
      questionCount: totalQ,
    });
  }

  // ── JSON Import Submit ───────────────────────────────────

  async function handleJsonImport(e: React.FormEvent) {
    e.preventDefault();
    setJsonError(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setJsonError("Invalid JSON — please validate first.");
      return;
    }

    setJsonSubmitting(true);
    try {
      const res = await fetch("/api/admin/textbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to import textbook");
      }

      const result = await res.json();
      const tb = result.textbook;
      toast.success(
        `"${tb.title}" imported successfully with ${tb.chapters?.length ?? 0} chapter(s).`
      );
      setJsonText("");
      setJsonValidation(null);
      await fetchTextbooks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setJsonSubmitting(false);
    }
  }

  // ── AI: Detect chapters from uploaded file ──────────────

  async function handleAiDetectChapters() {
    setAiError(null);

    if (!aiTitle.trim()) { setAiError("Title is required."); return; }
    if (!aiSubject) { setAiError("Subject is required."); return; }
    if (!aiGrade) { setAiError("Grade is required (1-12)."); return; }
    if (!aiFile) { setAiError("Please upload a PDF or DOCX file."); return; }

    setAiDetecting(true);
    setAiDetectedChapters([]);
    setAiExtractedInfo(null);

    try {
      const formData = new FormData();
      formData.append("title", aiTitle.trim());
      formData.append("subject", aiSubject);
      formData.append("grade", aiGrade);
      if (aiPublisher.trim()) formData.append("publisher", aiPublisher.trim());
      if (aiAcademicYear.trim()) formData.append("academicYear", aiAcademicYear.trim());
      formData.append("file", aiFile);

      const res = await fetch("/api/admin/textbooks/create-with-ai", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to detect chapters");
      }

      const data = await res.json();

      setAiExtractedInfo({
        contentLength: data.extractedContent.contentLength,
        wordCount: data.extractedContent.wordCount,
        pageCount: data.extractedContent.pageCount,
        fullText: data.extractedContent.fullText,
      });

      setAiDetectedChapters(
        (data.chapters ?? []).map((ch: { chapterNumber: number; title: string; contentPreview: string; contentLength: number; content: string }) => ({
          ...ch,
          _selected: true,
          _editing: false,
        }))
      );

      toast.success(
        `Detected ${data.chapters?.length ?? 0} chapters from ${data.extractedContent.wordCount?.toLocaleString()} words.`
      );
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Failed to detect chapters");
    } finally {
      setAiDetecting(false);
    }
  }

  // ── AI: Create textbook with detected chapters ──────────

  async function handleAiCreateTextbook() {
    const selected = aiDetectedChapters.filter((ch) => ch._selected);
    if (selected.length === 0) {
      setAiError("Select at least one chapter to create the textbook.");
      return;
    }

    setAiCreating(true);
    setAiError(null);

    try {
      const res = await fetch("/api/admin/textbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: aiTitle.trim(),
          subject: aiSubject,
          grade: parseInt(aiGrade, 10),
          publisher: aiPublisher.trim() || undefined,
          academicYear: aiAcademicYear.trim() || undefined,
          content: aiExtractedInfo?.fullText || undefined,
          chapters: selected.map((ch) => ({
            title: ch.title,
            chapterNumber: ch.chapterNumber,
            content: ch.content,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create textbook");
      }

      toast.success(
        `Textbook "${aiTitle.trim()}" created with ${selected.length} chapter(s)!`
      );

      // Reset AI form
      setAiTitle("");
      setAiSubject("");
      setAiGrade("");
      setAiPublisher("");
      setAiAcademicYear("");
      setAiFile(null);
      setAiDetectedChapters([]);
      setAiExtractedInfo(null);
      setAiError(null);

      await fetchTextbooks();
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Failed to create textbook");
    } finally {
      setAiCreating(false);
    }
  }

  // ── AI: chapter helpers ─────────────────────────────────

  function toggleChapter(index: number) {
    setAiDetectedChapters((prev) =>
      prev.map((ch, i) => (i === index ? { ...ch, _selected: !ch._selected } : ch))
    );
  }

  function toggleAllChapters(selected: boolean) {
    setAiDetectedChapters((prev) => prev.map((ch) => ({ ...ch, _selected: selected })));
  }

  function updateChapterTitle(index: number, title: string) {
    setAiDetectedChapters((prev) =>
      prev.map((ch, i) => (i === index ? { ...ch, title } : ch))
    );
  }

  function toggleEditChapter(index: number) {
    setAiDetectedChapters((prev) =>
      prev.map((ch, i) => (i === index ? { ...ch, _editing: !ch._editing } : ch))
    );
  }

  function removeChapter(index: number) {
    setAiDetectedChapters((prev) => prev.filter((_, i) => i !== index));
  }

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Textbook Management</h1>
        <p className="text-sm text-text-secondary">
          Add and manage your school&apos;s textbooks and their content.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Left Panel: Textbook List ── */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold text-text-primary">
                    Textbooks
                    {!loading && (
                      <span className="ml-2 text-sm font-normal text-text-secondary">
                        ({textbooks.length})
                      </span>
                    )}
                  </h2>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchTextbooks}
                  disabled={loading}
                >
                  {loading ? <Spinner size="sm" /> : "Refresh"}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner size="md" className="text-primary" />
                </div>
              ) : fetchError ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <XCircle className="h-8 w-8 text-error" />
                  <p className="text-sm text-text-secondary">{fetchError}</p>
                  <Button variant="outline" size="sm" onClick={fetchTextbooks}>
                    Try Again
                  </Button>
                </div>
              ) : textbooks.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <BookOpen className="h-10 w-10 text-text-muted" />
                  <p className="text-sm text-text-secondary">No textbooks yet.</p>
                  <p className="text-xs text-text-muted">
                    Use the AI Upload tab on the right to add one.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {textbooks.map((textbook) => {
                    const status = STATUS_CONFIG[textbook.processingStatus] ?? STATUS_CONFIG.PENDING;
                    const qCount = totalQuestions(textbook);
                    const isConfirming = confirmDeleteId === textbook.id;
                    const isDeleting = deletingId === textbook.id;

                    return (
                      <div
                        key={textbook.id}
                        className="flex items-start justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-text-primary">
                              {textbook.title}
                            </p>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                            <span>{textbook.subject}</span>
                            <Badge variant="default">Grade {textbook.grade}</Badge>
                            <span>
                              {textbook._count.chapters} chapter
                              {textbook._count.chapters !== 1 ? "s" : ""}
                            </span>
                            <span>
                              {qCount} question{qCount !== 1 ? "s" : ""}
                            </span>
                            {textbook.hasContent && (
                              <Badge variant="info">Content uploaded</Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
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
                                className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-300"
                                onClick={() => handleDelete(textbook.id)}
                              >
                                Yes
                              </Button>
                            </>
                          ) : (
                            <button
                              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Delete textbook"
                              disabled={isDeleting}
                              onClick={() => setConfirmDeleteId(textbook.id)}
                            >
                              {isDeleting ? (
                                <Spinner size="sm" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right Panel: Add Textbook ── */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                <h2 className="font-semibold text-text-primary">Add Textbook</h2>
              </div>
            </CardHeader>

            <CardContent>
              {/* Tab switcher */}
              <div className="mb-5 flex rounded-lg border border-border bg-background p-1">
                <button
                  onClick={() => setActiveTab("ai")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === "ai"
                      ? "bg-surface text-text-primary shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Sparkles className="h-4 w-4" />
                  AI Upload
                </button>
                <button
                  onClick={() => setActiveTab("simple")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === "simple"
                      ? "bg-surface text-text-primary shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <FileText className="h-4 w-4" />
                  Simple
                </button>
                <button
                  onClick={() => setActiveTab("json")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === "json"
                      ? "bg-surface text-text-primary shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <FileJson className="h-4 w-4" />
                  JSON
                </button>
              </div>

              {/* ── AI Upload Tab ── */}
              {activeTab === "ai" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="mb-1 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium text-text-primary">
                        AI-Powered Textbook Upload
                      </p>
                    </div>
                    <p className="text-xs text-text-secondary">
                      Fill in the details, upload a PDF/DOCX book, and AI will automatically detect chapters. Review and confirm to create.
                    </p>
                  </div>

                  {/* Textbook metadata form */}
                  <div className="space-y-3">
                    <Input
                      label="Title *"
                      placeholder="e.g. Mathematics Grade 9 Student Textbook"
                      value={aiTitle}
                      onChange={(e) => setAiTitle(e.target.value)}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <div className="w-full">
                        <label className="mb-2 block text-sm font-medium text-text-primary">
                          Subject *
                        </label>
                        <select
                          value={aiSubject}
                          onChange={(e) => setAiSubject(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                        >
                          <option value="">Select…</option>
                          {SUBJECTS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div className="w-full">
                        <label className="mb-2 block text-sm font-medium text-text-primary">
                          Grade *
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          placeholder="1-12"
                          value={aiGrade}
                          onChange={(e) => setAiGrade(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Publisher"
                        placeholder="e.g. MOE"
                        value={aiPublisher}
                        onChange={(e) => setAiPublisher(e.target.value)}
                      />
                      <Input
                        label="Academic Year"
                        placeholder="e.g. 2024/2025"
                        value={aiAcademicYear}
                        onChange={(e) => setAiAcademicYear(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* File upload */}
                  {aiDetectedChapters.length === 0 && (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-text-primary">
                        Upload Book *
                        <span className="ml-1 font-normal text-text-muted">(PDF or DOCX, max 50 MB)</span>
                      </label>

                      <div className="rounded-lg border-2 border-dashed border-border bg-background p-6 text-center">
                        <Upload className="mx-auto h-8 w-8 text-text-muted mb-2" />
                        <p className="text-sm text-text-secondary mb-1">
                          Upload your textbook file
                        </p>
                        <p className="text-xs text-text-muted mb-3">
                          AI will extract text and detect chapters automatically
                        </p>
                        <input
                          type="file"
                          accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            setAiFile(f);
                            setAiError(null);
                          }}
                          className="mx-auto block w-full max-w-xs cursor-pointer text-sm text-text-secondary file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
                        />
                      </div>

                      {aiFile && (
                        <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate text-sm text-text-primary">
                              {aiFile.name}
                            </span>
                            <span className="shrink-0 text-xs text-text-muted">
                              ({(aiFile.size / (1024 * 1024)).toFixed(1)} MB)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAiFile(null)}
                            className="shrink-0 p-1 text-text-muted hover:text-error"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}

                      <Button
                        type="button"
                        className="w-full"
                        isLoading={aiDetecting}
                        disabled={aiDetecting || !aiFile || !aiTitle.trim() || !aiSubject || !aiGrade}
                        onClick={handleAiDetectChapters}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        {aiDetecting ? "Extracting text & detecting chapters…" : "Upload & Detect Chapters"}
                      </Button>
                    </div>
                  )}

                  {/* Extraction info */}
                  {aiExtractedInfo && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <p className="text-sm font-medium text-green-800">
                          Text extracted successfully
                        </p>
                      </div>
                      <p className="text-xs text-green-700">
                        {aiExtractedInfo.pageCount ? `${aiExtractedInfo.pageCount} pages — ` : ""}
                        {aiExtractedInfo.wordCount.toLocaleString()} words —{" "}
                        {aiExtractedInfo.contentLength.toLocaleString()} characters
                      </p>
                    </div>
                  )}

                  {/* Detected chapters review */}
                  {aiDetectedChapters.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-text-primary">
                          Detected Chapters ({aiDetectedChapters.filter((c) => c._selected).length}/{aiDetectedChapters.length} selected)
                        </h3>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => toggleAllChapters(true)}
                            className="text-xs text-primary hover:underline"
                          >
                            Select All
                          </button>
                          <span className="text-text-muted">|</span>
                          <button
                            type="button"
                            onClick={() => toggleAllChapters(false)}
                            className="text-xs text-primary hover:underline"
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>

                      <div className="max-h-[400px] overflow-y-auto space-y-2">
                        {aiDetectedChapters.map((ch, idx) => (
                          <div
                            key={idx}
                            className={`rounded-lg border p-3 text-sm transition-colors ${
                              ch._selected
                                ? "border-primary/30 bg-primary/5"
                                : "border-border bg-surface opacity-60"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={ch._selected}
                                onChange={() => toggleChapter(idx)}
                                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-text-muted">
                                    Ch. {ch.chapterNumber}
                                  </span>
                                  {ch._editing ? (
                                    <input
                                      type="text"
                                      value={ch.title}
                                      onChange={(e) => updateChapterTitle(idx, e.target.value)}
                                      onBlur={() => toggleEditChapter(idx)}
                                      onKeyDown={(e) => { if (e.key === "Enter") toggleEditChapter(idx); }}
                                      autoFocus
                                      className="flex-1 rounded border border-primary bg-white px-2 py-0.5 text-sm text-text-primary outline-none"
                                    />
                                  ) : (
                                    <span className="font-medium text-text-primary">
                                      {ch.title}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-text-muted">
                                  <span>{ch.contentLength.toLocaleString()} chars</span>
                                  {ch.contentPreview && (
                                    <span className="truncate max-w-[200px]" title={ch.contentPreview}>
                                      {ch.contentPreview.slice(0, 80)}…
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggleEditChapter(idx)}
                                  className="rounded p-1 text-text-muted hover:bg-primary/10 hover:text-primary"
                                  title="Edit title"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeChapter(idx)}
                                  className="rounded p-1 text-text-muted hover:bg-red-50 hover:text-red-600"
                                  title="Remove chapter"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            setAiDetectedChapters([]);
                            setAiExtractedInfo(null);
                            setAiFile(null);
                          }}
                        >
                          Start Over
                        </Button>
                        <Button
                          type="button"
                          className="flex-1"
                          isLoading={aiCreating}
                          disabled={aiCreating || aiDetectedChapters.filter((c) => c._selected).length === 0}
                          onClick={handleAiCreateTextbook}
                        >
                          <Check className="mr-2 h-4 w-4" />
                          Create Textbook ({aiDetectedChapters.filter((c) => c._selected).length} chapters)
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Error display */}
                  {aiError && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-error">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {aiError}
                    </div>
                  )}
                </div>
              )}

              {/* ── Simple Form Tab ── */}
              {activeTab === "simple" && (
                <form onSubmit={handleSimpleSubmit} className="space-y-4">
                  <Input
                    label="Title"
                    placeholder="e.g. Grade 10 Biology"
                    value={simpleTitle}
                    onChange={(e) => setSimpleTitle(e.target.value)}
                  />

                  <div className="w-full">
                    <label className="mb-2 block text-sm font-medium text-text-primary">
                      Subject
                    </label>
                    <select
                      value={simpleSubject}
                      onChange={(e) => setSimpleSubject(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Select subject…</option>
                      {SUBJECTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="w-full">
                    <label className="mb-2 block text-sm font-medium text-text-primary">
                      Grade
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      placeholder="1-12"
                      value={simpleGrade}
                      onChange={(e) => setSimpleGrade(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="w-full">
                    <label className="mb-2 block text-sm font-medium text-text-primary">
                      Chapter Titles{" "}
                      <span className="font-normal text-text-muted">(one per line, optional)</span>
                    </label>
                    <textarea
                      value={simpleChapterTitles}
                      onChange={(e) => setSimpleChapterTitles(e.target.value)}
                      placeholder={"Chapter 1: Introduction\nChapter 2: Motion\nChapter 3: Forces"}
                      rows={5}
                      className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                    <p className="mt-1 text-xs text-text-muted">
                      Questions can be added later via JSON Import or AI Generation.
                    </p>
                  </div>

                  {simpleError && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-error">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {simpleError}
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    isLoading={simpleSubmitting}
                  >
                    Create Textbook
                  </Button>
                </form>
              )}

              {/* ── JSON Import Tab ── */}
              {activeTab === "json" && (
                <form onSubmit={handleJsonImport} className="space-y-4">
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium text-text-primary">
                        Paste your textbook JSON
                      </p>
                    </div>
                    <p className="mb-3 text-xs text-text-secondary">
                      Use the format below. The{" "}
                      <code className="rounded bg-surface px-1 py-0.5 text-xs">difficulty</code>{" "}
                      field accepts <code className="rounded bg-surface px-1 py-0.5 text-xs">EASY</code>,{" "}
                      <code className="rounded bg-surface px-1 py-0.5 text-xs">MEDIUM</code>, or{" "}
                      <code className="rounded bg-surface px-1 py-0.5 text-xs">HARD</code>.
                    </p>

                    {/* Collapsible example */}
                    <JsonExample />
                  </div>

                  <div className="w-full">
                    <label className="mb-2 block text-sm font-medium text-text-primary">
                      JSON Content
                    </label>
                    <textarea
                      value={jsonText}
                      onChange={(e) => {
                        setJsonText(e.target.value);
                        setJsonValidation(null);
                        setJsonError(null);
                      }}
                      placeholder="Paste JSON here…"
                      rows={10}
                      className="w-full rounded-lg border border-border bg-surface px-4 py-3 font-mono text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Validation result */}
                  {jsonValidation && (
                    <div
                      className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
                        jsonValidation.valid
                          ? "bg-green-50 text-success"
                          : "bg-red-50 text-error"
                      }`}
                    >
                      {jsonValidation.valid ? (
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      {jsonValidation.message}
                    </div>
                  )}

                  {jsonError && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-error">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {jsonError}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={handleValidateJson}
                    >
                      Validate JSON
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1"
                      isLoading={jsonSubmitting}
                      disabled={jsonSubmitting}
                    >
                      Import Textbook
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── JSON Example Collapsible ─────────────────────────────

function JsonExample() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary"
      >
        <span>Show example format</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <pre className="overflow-x-auto rounded-b-lg bg-surface px-3 pb-3 pt-1 font-mono text-xs text-text-primary">
          {JSON_EXAMPLE}
        </pre>
      )}
    </div>
  );
}
