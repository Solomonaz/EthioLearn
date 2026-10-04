"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Trash2, Plus, FileJson, FileText, ChevronDown, ChevronUp, XCircle, AlertCircle, CheckCircle, Sparkles, Check, X, Upload, Edit3, Cpu, TriangleAlert, ArrowUp, ArrowDown, Merge, ChevronRight, ScanEye, Library, School, Clock, Download, Send, RotateCw, Ban, BookOpenText } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { useEntitlements } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────

interface TextbookListItem {
  id: string;
  title: string;
  subject: string;
  grade: number;
  processingStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  chunkingStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  createdAt: string;
  hasContent: boolean;
  contentLength: number;
  _count: { chapters: number };
  chapters: { id: string; title: string; chapterNumber: number; _count: { questions: number }; ocrConfidence: number | null }[];
  /** National-library book (no owning school) — shared by every school. */
  isLibrary: boolean;
  schoolName: string | null;
  /** Whether this admin may edit / process / delete it. */
  canManage: boolean;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  requestNote: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  requestedBy: string | null;
  hasSourceFile: boolean;
  sourceFileName: string | null;
  sourceFileSize: number | null;
  /** PDF students read in the Library. */
  hasReaderFile: boolean;
  readerFileSize: number | null;
  processingError: string | null;
  updatedAt: string;
}

/** Mirrors the review route: a background ingest this old died with the server. */
const INGEST_STALE_MS = 30 * 60 * 1000;
function ingestStuck(tb: TextbookListItem): boolean {
  return (
    tb.approvalStatus === "APPROVED" &&
    tb.processingStatus === "PROCESSING" &&
    tb._count.chapters === 0 &&
    tb.hasSourceFile &&
    Date.now() - new Date(tb.updatedAt).getTime() > INGEST_STALE_MS
  );
}

function formatBytes(n: number | null): string {
  if (!n) return "";
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

type SourceFilter = "all" | "library" | "school";

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

const CHUNKING_STATUS_CONFIG: Record<
  TextbookListItem["chunkingStatus"],
  { label: string; variant: "success" | "warning" | "error" | "default" | "info" } | null
> = {
  COMPLETED: { label: "Vectors Ready", variant: "success" },
  PENDING: null, // don't show badge when not yet processed
  PROCESSING: { label: "Processing Vectors…", variant: "info" },
  FAILED: { label: "Vector Failed", variant: "error" },
};

// ─── Helper: count total questions ────────────────────────

function totalQuestions(textbook: TextbookListItem): number {
  return textbook.chapters.reduce((sum, ch) => sum + ch._count.questions, 0);
}

// Mirrors subjectKey in lib/subject (server-only module, it imports the db).
function subjectKey(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ─── Main Component ───────────────────────────────────────

export default function AdminTextbooksPage() {
  const t = useTranslations("admin");
  const [textbooks, setTextbooks] = useState<TextbookListItem[]>([]);
  const [subjectsList, setSubjectsList] = useState<{id: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  // The right-hand panel differs by role; don't render it until we know which.
  const [viewerLoaded, setViewerLoaded] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  // "" = all. Subject holds the subjectKey so "biology" and "Biology" are one.
  const [subjectFilter, setSubjectFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  // Super admin only: upload even though the grade + subject already exists.
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [jsonMeta, setJsonMeta] = useState<{ grade: number; subject: string } | null>(null);

  const ent = useEntitlements();
  const aiUploadEnabled = ent.aiFeatures.aiQuizGen;
  const [activeTab, setActiveTab] = useState<"simple" | "json" | "ai">("ai");

  // If AI upload is turned off platform-wide, never sit on the AI tab.
  useEffect(() => {
    if (!aiUploadEnabled && activeTab === "ai") setActiveTab("simple");
  }, [aiUploadEnabled, activeTab]);

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

  // Process (vector embedding) state
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Chapter management state
  const [expandedTextbookId, setExpandedTextbookId] = useState<string | null>(null);
  const [reorderingChapter, setReorderingChapter] = useState<string | null>(null);
  // merge: null | { textbookId, sourceChapterId, choosing: bool }
  const [mergeState, setMergeState] = useState<{
    textbookId: string;
    sourceChapterId: string;
    sourceTitle: string;
    targetChapterId: string | null;
  } | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // OCR review queue
  const [showOcrQueue, setShowOcrQueue] = useState(false);

  // ── Fetch textbooks ──────────────────────────────────────

  const fetchTextbooks = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFetchError(null);
    try {
      const [res, subRes] = await Promise.all([
        fetch("/api/admin/textbooks"),
        fetch("/api/subjects")
      ]);
      if (!res.ok) throw new Error("Failed to load textbooks");
      const data = await res.json();
      setTextbooks(data.textbooks ?? []);
      setIsSuperAdmin(!!data.viewer?.isSuperAdmin);
      setViewerLoaded(true);

      if (subRes.ok) {
        const subData = await subRes.json();
        setSubjectsList(subData.subjects ?? []);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTextbooks();
  }, [fetchTextbooks]);

  // An approved request is ingested in the background — poll until it lands.
  const ingesting = textbooks.some(
    (tb) => tb.approvalStatus === "APPROVED" && tb.processingStatus === "PROCESSING" && tb._count.chapters === 0,
  );
  useEffect(() => {
    if (!ingesting) return;
    const t = setInterval(() => fetchTextbooks({ silent: true }), 5000);
    return () => clearInterval(t);
  }, [ingesting, fetchTextbooks]);

  const pendingRequests = textbooks.filter((tb) => tb.approvalStatus === "PENDING");

  // ── Process Content (chunking + embeddings) ─────────────

  async function handleProcessContent(id: string) {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/admin/textbooks/${id}/process`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Processing failed");
      toast.success(
        `Content processed: ${data.totalChunks} chunks, ${data.totalEmbeddings} embeddings created.`
      );
      await fetchTextbooks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setProcessingId(null);
    }
  }

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

  // ── Chapter Reorder ─────────────────────────────────────

  async function handleMoveChapter(
    textbookId: string,
    chapterId: string,
    action: "move_up" | "move_down"
  ) {
    setReorderingChapter(chapterId);
    try {
      const res = await fetch(
        `/api/admin/textbooks/${textbookId}/chapters/${chapterId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to reorder chapter");
        return;
      }
      await fetchTextbooks();
    } catch {
      toast.error("Failed to reorder chapter");
    } finally {
      setReorderingChapter(null);
    }
  }

  // ── Chapter Merge ────────────────────────────────────────

  async function handleMergeChapters() {
    if (!mergeState || !mergeState.targetChapterId) return;
    setIsMerging(true);
    try {
      const res = await fetch(
        `/api/admin/textbooks/${mergeState.textbookId}/chapters/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceChapterId: mergeState.sourceChapterId,
            targetChapterId: mergeState.targetChapterId,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Merge failed");
        return;
      }
      toast.success("Chapters merged successfully!");
      setMergeState(null);
      await fetchTextbooks();
    } catch {
      toast.error("Failed to merge chapters");
    } finally {
      setIsMerging(false);
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
          allowDuplicate: allowDuplicate || undefined,
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

    setJsonMeta({ grade: data.grade, subject: data.subject });
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
        body: JSON.stringify({ ...(parsed as object), allowDuplicate: allowDuplicate || undefined }),
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
    // The title usually names the grade ("Biology Grade 11"). If it disagrees
    // with the grade picked, one of them is a slip — stop before the book is
    // filed where nobody will look for it.
    const titleGrade = aiTitle.match(/\bgrade\s*(\d{1,2})\b/i)?.[1];
    if (titleGrade && Number(titleGrade) !== Number(aiGrade)) {
      setAiError(`The title says Grade ${titleGrade} but Grade ${aiGrade} is selected. Fix whichever is wrong.`);
      return;
    }
    if (!aiFile) { setAiError("Please upload a PDF, DOCX, or EPUB file."); return; }

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
      if (allowDuplicate) formData.append("allowDuplicate", "1");

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
          allowDuplicate: allowDuplicate || undefined,
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

  // ─── Library / duplicate derived data ────────────────────

  const libraryCount = textbooks.filter((tb) => tb.isLibrary).length;
  const schoolCount = textbooks.length - libraryCount;
  const subjectOptions = [
    ...new Map(textbooks.map((tb) => [subjectKey(tb.subject), tb.subject.trim()])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const gradeOptions = [...new Set(textbooks.map((tb) => tb.grade))].sort((a, b) => a - b);
  const visibleTextbooks = textbooks
    .filter((tb) =>
      sourceFilter === "library" ? tb.isLibrary : sourceFilter === "school" ? !tb.isLibrary : true,
    )
    .filter((tb) => !subjectFilter || subjectKey(tb.subject) === subjectFilter)
    .filter((tb) => !gradeFilter || tb.grade === Number(gradeFilter));

  // Same rule the server enforces (lib/textbook-access findDuplicateTextbooks):
  // grade + subject already in the library, or already uploaded by this school.
  function duplicatesFor(grade: string | number, subject: string): TextbookListItem[] {
    if (!grade || !subject) return [];
    return textbooks
      .filter(
        (tb) =>
          tb.approvalStatus !== "REJECTED" &&
          tb.grade === Number(grade) &&
          subjectKey(tb.subject) === subjectKey(subject) &&
          (tb.isLibrary || (!isSuperAdmin && tb.canManage)),
      )
      .sort((a, b) => Number(b.isLibrary) - Number(a.isLibrary));
  }
  const aiDuplicates = duplicatesFor(aiGrade, aiSubject);
  const simpleDuplicates = duplicatesFor(simpleGrade, simpleSubject);
  const jsonDuplicates = jsonMeta ? duplicatesFor(jsonMeta.grade, jsonMeta.subject) : [];
  const overrideOk = isSuperAdmin && allowDuplicate;
  const aiBlocked = aiDuplicates.length > 0 && !overrideOk;
  const simpleBlocked = simpleDuplicates.length > 0 && !overrideOk;
  const jsonBlocked = jsonDuplicates.length > 0 && !overrideOk;

  function jumpToTextbook(id: string) {
    setSourceFilter("all");
    setSubjectFilter("");
    setGradeFilter("");
    setExpandedTextbookId(id);
    setTimeout(() => {
      document.getElementById(`textbook-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  // ─── OCR Queue derived data ──────────────────────────────

  const ocrQueue = textbooks.filter((tb) => tb.canManage).flatMap((tb) =>
    tb.chapters
      .filter((ch) => ch.ocrConfidence !== null && ch.ocrConfidence < 80)
      .map((ch) => ({
        textbookId: tb.id,
        textbookTitle: tb.title,
        chapterId: ch.id,
        chapterTitle: ch.title,
        chapterNumber: ch.chapterNumber,
        ocrConfidence: ch.ocrConfidence!,
      }))
  ).sort((a, b) => a.ocrConfidence - b.ocrConfidence); // worst first

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* Page title */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t("textbooksTitle")}</h1>
          <p className="text-sm text-text-secondary">
            {isSuperAdmin
              ? "Books without a school form the national library — every school's students get them."
              : "Your students get every national library book automatically, plus anything your school uploads."}
          </p>
        </div>
        {!loading && ocrQueue.length > 0 && (
          <button
            onClick={() => setShowOcrQueue((v) => !v)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              showOcrQueue
                ? "border-amber-400 bg-amber-50 text-amber-800"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
            }`}
          >
            <ScanEye className="h-4 w-4" />
            OCR Review Queue ({ocrQueue.length})
          </button>
        )}
      </div>

      {!loading && !isSuperAdmin && libraryCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/5 px-4 py-3">
          <Library className="mt-0.5 h-5 w-5 shrink-0 text-info" />
          <div className="text-sm">
            <p className="font-medium text-text-primary">
              {libraryCount} national library book{libraryCount !== 1 ? "s" : ""} already available to your students
            </p>
            <p className="text-text-secondary">
              No need to upload these. To add a book your school uses that isn&apos;t in the library, send a
              request — the platform team reviews it before it&apos;s processed.
            </p>
          </div>
        </div>
      )}

      {isSuperAdmin && pendingRequests.length > 0 && (
        <ApprovalQueue
          requests={pendingRequests}
          textbooks={textbooks}
          onChanged={() => fetchTextbooks({ silent: true })}
          onView={jumpToTextbook}
        />
      )}

      {/* ── OCR Review Queue ── */}
      {showOcrQueue && ocrQueue.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TriangleAlert className="h-5 w-5 text-amber-500" />
                <h2 className="font-semibold text-text-primary">OCR Review Queue</h2>
              </div>
              <p className="text-xs text-text-secondary">
                {ocrQueue.length} chapter{ocrQueue.length !== 1 ? "s" : ""} with OCR confidence below 80% — review or re-upload their content.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-gray-50/50">
                    <th className="px-4 py-2 text-left font-medium text-text-secondary">Textbook</th>
                    <th className="px-4 py-2 text-left font-medium text-text-secondary">Chapter</th>
                    <th className="px-4 py-2 text-center font-medium text-text-secondary">OCR Confidence</th>
                    <th className="px-4 py-2 text-left font-medium text-text-secondary">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {ocrQueue.map((item) => (
                    <tr key={item.chapterId} className="hover:bg-amber-50/30">
                      <td className="px-4 py-2 text-text-primary font-medium truncate max-w-[180px]">
                        {item.textbookTitle}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        Ch.{item.chapterNumber} {item.chapterTitle}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                            item.ocrConfidence < 60
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {Math.round(item.ocrConfidence)}%
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => {
                            setExpandedTextbookId(item.textbookId);
                            setShowOcrQueue(false);
                            // scroll into view after state update
                            setTimeout(() => {
                              document
                                .getElementById(`textbook-${item.textbookId}`)
                                ?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }, 100);
                          }}
                        >
                          Review chapters →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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
                  onClick={() => fetchTextbooks()}
                  disabled={loading}
                >
                  {loading ? <Spinner size="sm" /> : "Refresh"}
                </Button>
              </div>
            </CardHeader>

            {!loading && textbooks.length > 0 && (
              <div className="px-6 pt-4">
                <div className="flex gap-1 rounded-lg bg-background p-1">
                  {([
                    ["all", "All", textbooks.length],
                    ["library", "National library", libraryCount],
                    ["school", isSuperAdmin ? "School uploads" : "Your school", schoolCount],
                  ] as const).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSourceFilter(key)}
                      className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                        sourceFilter === key
                          ? "bg-surface text-text-primary shadow-sm"
                          : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {label}
                      <span className="rounded-full bg-border/50 px-1.5 tabular-nums text-text-muted">{count}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    aria-label="Filter by subject"
                    value={subjectFilter}
                    onChange={(e) => setSubjectFilter(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                  >
                    <option value="">All subjects</option>
                    {subjectOptions.map(([key, name]) => (
                      <option key={key} value={key}>{name}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by grade"
                    value={gradeFilter}
                    onChange={(e) => setGradeFilter(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                  >
                    <option value="">All grades</option>
                    {gradeOptions.map((g) => (
                      <option key={g} value={g}>Grade {g}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner size="md" className="text-primary" />
                </div>
              ) : fetchError ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <XCircle className="h-8 w-8 text-error" />
                  <p className="text-sm text-text-secondary">{fetchError}</p>
                  <Button variant="outline" size="sm" onClick={() => fetchTextbooks()}>
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
              ) : visibleTextbooks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <BookOpen className="h-8 w-8 text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    {sourceFilter === "school"
                      ? "No school uploads — your students are using the national library."
                      : "No textbooks here."}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {visibleTextbooks.map((textbook) => {
                    const status = STATUS_CONFIG[textbook.processingStatus] ?? STATUS_CONFIG.PENDING;
                    const chunkStatus = CHUNKING_STATUS_CONFIG[textbook.chunkingStatus];
                    const qCount = totalQuestions(textbook);
                    const isConfirming = confirmDeleteId === textbook.id;
                    const isDeleting = deletingId === textbook.id;
                    const isProcessing = processingId === textbook.id;

                    // OCR warnings: chapters with confidence < 80
                    const ocrFlaggedChapters = textbook.chapters.filter(
                      (ch) => ch.ocrConfidence !== null && ch.ocrConfidence < 80
                    );

                    return (
                      <div
                        key={textbook.id}
                        id={`textbook-${textbook.id}`}
                        className="flex flex-col gap-2 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium text-text-primary">
                                {textbook.title}
                              </p>
                              {textbook.isLibrary ? (
                                <Badge variant="info" className="gap-1">
                                  <Library className="h-3 w-3" />
                                  National library
                                </Badge>
                              ) : isSuperAdmin ? (
                                <Badge variant="default" className="gap-1">
                                  <School className="h-3 w-3" />
                                  {textbook.schoolName ?? "School"}
                                </Badge>
                              ) : null}
                              {textbook.approvalStatus === "PENDING" ? (
                                <Badge variant="warning" className="gap-1">
                                  <Clock className="h-3 w-3" />
                                  Awaiting approval
                                </Badge>
                              ) : textbook.approvalStatus === "REJECTED" ? (
                                <Badge variant="error" className="gap-1">
                                  <Ban className="h-3 w-3" />
                                  Not approved
                                </Badge>
                              ) : textbook.processingStatus === "PROCESSING" && textbook._count.chapters === 0 ? (
                                <Badge variant="info" className="gap-1">
                                  <Spinner size="sm" />
                                  Detecting chapters…
                                </Badge>
                              ) : (
                                <Badge variant={status.variant}>{status.label}</Badge>
                              )}
                              {chunkStatus && (
                                <Badge variant={chunkStatus.variant}>{chunkStatus.label}</Badge>
                              )}
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

                          {textbook.canManage ? (
                          <div className="flex shrink-0 items-center gap-2">
                            {textbook.approvalStatus === "APPROVED" && !isConfirming && (
                              <ReaderPdfButton
                                id={textbook.id}
                                hasFile={textbook.hasReaderFile}
                                size={textbook.readerFileSize}
                                onDone={() => fetchTextbooks({ silent: true })}
                              />
                            )}
                            {/* Process Content Button */}
                            {textbook.hasContent && textbook.approvalStatus === "APPROVED" && !isConfirming && (
                              <button
                                className="rounded-lg p-2 text-text-muted transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                title="Process content: chunk text and generate vector embeddings"
                                disabled={isProcessing || textbook.chunkingStatus === "PROCESSING"}
                                onClick={() => handleProcessContent(textbook.id)}
                              >
                                {isProcessing ? (
                                  <Spinner size="sm" />
                                ) : (
                                  <Cpu className="h-4 w-4" />
                                )}
                              </button>
                            )}

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
                          ) : (
                            <span className="shrink-0 text-xs text-text-muted" title="Managed by the platform, shared with every school">
                              Read-only
                            </span>
                          )}
                        </div>

                        {/* Request status details */}
                        {textbook.approvalStatus === "PENDING" && (
                          <p className="text-xs text-text-secondary">
                            {isSuperAdmin
                              ? "Waiting for your review — see Approval requests above."
                              : "The platform team will review this request. Nothing is processed until it's approved."}
                          </p>
                        )}
                        {textbook.approvalStatus === "REJECTED" && (
                          <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-text-secondary">
                            <span className="font-medium text-error">Reason: </span>
                            {textbook.reviewNote ?? "No reason given."}
                            {textbook.canManage && !isSuperAdmin && (
                              <span className="text-text-muted"> You can delete this request.</span>
                            )}
                          </div>
                        )}
                        {(ingestStuck(textbook) ||
                          (textbook.approvalStatus === "APPROVED" && textbook.processingStatus === "FAILED" && textbook.processingError)) && (
                          <div className="flex items-start justify-between gap-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-text-secondary">
                            <span>
                              <span className="font-medium text-error">Chapter detection failed: </span>
                              {textbook.processingError ?? "It stopped without finishing (the server may have restarted)."}
                            </span>
                            {isSuperAdmin && textbook.hasSourceFile && (
                              <RetryIngestButton id={textbook.id} onDone={() => fetchTextbooks({ silent: true })} />
                            )}
                          </div>
                        )}

                        {/* OCR Confidence Warnings */}
                        {ocrFlaggedChapters.length > 0 && (
                          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <span>
                              <strong>Low OCR confidence:</strong>{" "}
                              {ocrFlaggedChapters.map((ch) => (
                                <span key={ch.id}>
                                  {ch.title} ({Math.round(ch.ocrConfidence!)}%)
                                </span>
                              )).reduce((acc: React.ReactNode[], el, i) => [
                                ...acc, i > 0 ? ", " : "", el
                              ], [])}{" "}
                              — review these chapters manually.
                            </span>
                          </div>
                        )}

                        {/* Chapters expand/collapse */}
                        {textbook.chapters.length > 0 && (
                          <div>
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                              onClick={() =>
                                setExpandedTextbookId((prev) =>
                                  prev === textbook.id ? null : textbook.id
                                )
                              }
                            >
                              {expandedTextbookId === textbook.id ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                              {textbook.canManage ? "Manage" : "View"} Chapters ({textbook.chapters.length})
                            </button>

                            {expandedTextbookId === textbook.id && (
                              <div className="mt-2 rounded-lg border border-border bg-background">
                                {/* Merge confirmation banner */}
                                {mergeState?.textbookId === textbook.id && (
                                  <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                                    <span className="text-amber-800">
                                      <strong>Merging:</strong> &ldquo;{mergeState.sourceTitle}&rdquo; →{" "}
                                      {mergeState.targetChapterId
                                        ? `"${textbook.chapters.find((c) => c.id === mergeState.targetChapterId)?.title}"`
                                        : "select a target chapter below"}
                                    </span>
                                    <div className="flex gap-2">
                                      {mergeState.targetChapterId && (
                                        <Button
                                          size="sm"
                                          isLoading={isMerging}
                                          onClick={handleMergeChapters}
                                          className="bg-amber-600 text-white hover:bg-amber-700 text-xs px-2 py-1 h-auto"
                                        >
                                          Confirm Merge
                                        </Button>
                                      )}
                                      <button
                                        className="text-amber-700 hover:text-amber-900"
                                        onClick={() => setMergeState(null)}
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Chapter list */}
                                <div className="divide-y divide-border/50">
                                  {[...textbook.chapters]
                                    .sort((a, b) => a.chapterNumber - b.chapterNumber)
                                    .map((ch, idx, arr) => {
                                      const isFirst = idx === 0;
                                      const isLast = idx === arr.length - 1;
                                      const isReordering = reorderingChapter === ch.id;
                                      const isMergeSource =
                                        mergeState?.sourceChapterId === ch.id;
                                      const isMergeTarget =
                                        mergeState?.targetChapterId === ch.id;
                                      const isChoosingMergeTarget =
                                        mergeState?.textbookId === textbook.id &&
                                        mergeState?.sourceChapterId !== ch.id;

                                      return (
                                        <div
                                          key={ch.id}
                                          className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                                            isMergeSource
                                              ? "bg-amber-50"
                                              : isMergeTarget
                                              ? "bg-amber-100"
                                              : isChoosingMergeTarget
                                              ? "cursor-pointer hover:bg-amber-50"
                                              : "hover:bg-background"
                                          }`}
                                          onClick={
                                            isChoosingMergeTarget && !isMergeSource
                                              ? () =>
                                                  setMergeState((prev) =>
                                                    prev
                                                      ? { ...prev, targetChapterId: ch.id }
                                                      : null
                                                  )
                                              : undefined
                                          }
                                        >
                                          {/* Chapter number */}
                                          <span className="shrink-0 w-6 text-text-muted font-mono">
                                            {ch.chapterNumber}.
                                          </span>

                                          {/* Title + meta */}
                                          <div className="flex-1 min-w-0">
                                            <span
                                              className={`font-medium ${
                                                isMergeSource
                                                  ? "text-amber-700"
                                                  : isMergeTarget
                                                  ? "text-amber-800"
                                                  : "text-text-primary"
                                              }`}
                                            >
                                              {ch.title}
                                            </span>
                                            <span className="ml-2 text-text-muted">
                                              {ch._count.questions}q
                                            </span>
                                            {ch.ocrConfidence !== null &&
                                              ch.ocrConfidence < 80 && (
                                                <span className="ml-1 text-amber-600">
                                                  ⚠ {Math.round(ch.ocrConfidence)}% OCR
                                                </span>
                                              )}
                                          </div>

                                          {/* Actions (hidden when in merge-target-picking mode) */}
                                          {!isChoosingMergeTarget && textbook.canManage && (
                                            <div className="flex shrink-0 items-center gap-1">
                                              <button
                                                disabled={isFirst || isReordering}
                                                onClick={() =>
                                                  handleMoveChapter(
                                                    textbook.id,
                                                    ch.id,
                                                    "move_up"
                                                  )
                                                }
                                                className="rounded p-1 text-text-muted hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                                                title="Move up"
                                              >
                                                <ArrowUp className="h-3 w-3" />
                                              </button>
                                              <button
                                                disabled={isLast || isReordering}
                                                onClick={() =>
                                                  handleMoveChapter(
                                                    textbook.id,
                                                    ch.id,
                                                    "move_down"
                                                  )
                                                }
                                                className="rounded p-1 text-text-muted hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                                                title="Move down"
                                              >
                                                <ArrowDown className="h-3 w-3" />
                                              </button>
                                              {textbook.chapters.length > 1 && (
                                                <button
                                                  onClick={() =>
                                                    setMergeState({
                                                      textbookId: textbook.id,
                                                      sourceChapterId: ch.id,
                                                      sourceTitle: ch.title,
                                                      targetChapterId: null,
                                                    })
                                                  }
                                                  className="rounded p-1 text-text-muted hover:bg-amber-50 hover:text-amber-700"
                                                  title="Merge into another chapter"
                                                >
                                                  <Merge className="h-3 w-3" />
                                                </button>
                                              )}
                                            </div>
                                          )}

                                          {/* "Select as target" indicator */}
                                          {isChoosingMergeTarget && !isMergeSource && (
                                            <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                                              {isMergeTarget ? "✓ Target" : "Merge into"}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right Panel: Add Textbook (super admin) / Request (school) ── */}
        <div className="flex flex-col gap-4">
          {!viewerLoaded ? null : !isSuperAdmin ? (
            <TextbookRequestForm
              subjects={subjectsList}
              duplicatesFor={duplicatesFor}
              onView={jumpToTextbook}
              onSubmitted={() => {
                setSourceFilter("school");
                fetchTextbooks({ silent: true });
              }}
            />
          ) : (
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
                {aiUploadEnabled && (
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
                )}
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

              {/* ── AI Upload Tab (hidden when AI is off) ── */}
              {activeTab === "ai" && aiUploadEnabled && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="mb-1 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium text-text-primary">
                        AI-Powered Textbook Upload
                      </p>
                    </div>
                    <p className="text-xs text-text-secondary">
                      Fill in the details, upload a PDF, DOCX, or EPUB book, and AI will automatically detect chapters. Review and confirm to create.
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      💡 After creating, click the <Cpu className="inline h-3 w-3" /> icon on a textbook to process its content into semantic vector embeddings for smarter exam generation.
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
                          {subjectsList.map((s) => (
                            <option key={s.id} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="w-full">
                        <label className="mb-2 block text-sm font-medium text-text-primary">
                          Grade *
                        </label>
                        {/* A list, not a free number box: typing "1" for "11"
                            filed a Grade 11 book as Grade 1, where no Grade 11
                            teacher or student could ever find it. */}
                        <select
                          value={aiGrade}
                          onChange={(e) => setAiGrade(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                        >
                          <option value="">Select…</option>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                            <option key={g} value={String(g)}>Grade {g}</option>
                          ))}
                        </select>
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

                  <DuplicateNotice
                    matches={aiDuplicates}
                    isSuperAdmin={isSuperAdmin}
                    allowDuplicate={allowDuplicate}
                    onAllowDuplicate={setAllowDuplicate}
                    onView={jumpToTextbook}
                  />

                  {/* File upload */}
                  {aiDetectedChapters.length === 0 && (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-text-primary">
                        Upload Book *
                        <span className="ml-1 font-normal text-text-muted">(PDF, DOCX, or EPUB, max 50 MB)</span>
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
                          accept=".pdf,.docx,.doc,.epub,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/epub+zip"
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
                        disabled={aiDetecting || aiBlocked || !aiFile || !aiTitle.trim() || !aiSubject || !aiGrade}
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
                          disabled={aiCreating || aiBlocked || aiDetectedChapters.filter((c) => c._selected).length === 0}
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
                      {subjectsList.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="w-full">
                    <label className="mb-2 block text-sm font-medium text-text-primary">
                      Grade
                    </label>
                    {/* A list, not a free number box — see the AI upload form. */}
                    <select
                      value={simpleGrade}
                      onChange={(e) => setSimpleGrade(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Select…</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                        <option key={g} value={String(g)}>Grade {g}</option>
                      ))}
                    </select>
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

                  <DuplicateNotice
                    matches={simpleDuplicates}
                    isSuperAdmin={isSuperAdmin}
                    allowDuplicate={allowDuplicate}
                    onAllowDuplicate={setAllowDuplicate}
                    onView={jumpToTextbook}
                  />

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
                    disabled={simpleSubmitting || simpleBlocked}
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
                        setJsonMeta(null);
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

                  {jsonValidation?.valid && (
                    <DuplicateNotice
                      matches={jsonDuplicates}
                      isSuperAdmin={isSuperAdmin}
                      allowDuplicate={allowDuplicate}
                      onAllowDuplicate={setAllowDuplicate}
                      onView={jumpToTextbook}
                    />
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
                      disabled={jsonSubmitting || jsonBlocked}
                    >
                      Import Textbook
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Textbook request form (school admins) ────────────────

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary";

function TextbookRequestForm({
  subjects,
  duplicatesFor,
  onView,
  onSubmitted,
}: {
  subjects: { id: string; name: string }[];
  duplicatesFor: (grade: string, subject: string) => TextbookListItem[];
  onView: (id: string) => void;
  onSubmitted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [publisher, setPublisher] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duplicates = duplicatesFor(grade, subject);
  const blocked = duplicates.length > 0;
  const ready = !!title.trim() && !!subject && !!grade && reason.trim().length >= 10 && !!file;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || blocked || !file) return;
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("subject", subject);
      fd.append("grade", grade);
      if (publisher.trim()) fd.append("publisher", publisher.trim());
      if (academicYear.trim()) fd.append("academicYear", academicYear.trim());
      fd.append("reason", reason.trim());
      fd.append("file", file);
      const res = await fetch("/api/admin/textbooks/requests", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not submit the request");
      toast.success("Request sent. You'll get a notification when it's reviewed.");
      setTitle("");
      setSubject("");
      setGrade("");
      setPublisher("");
      setAcademicYear("");
      setReason("");
      setFile(null);
      setFileKey((k) => k + 1);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-text-primary">Request a Textbook</h2>
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          For a book your school uses that isn&apos;t in the national library. The platform team reviews each
          request; once approved, chapters are detected automatically and you&apos;re notified.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <Input
            label="Title *"
            placeholder="e.g. Cambridge IGCSE Chemistry Coursebook"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-text-primary">Subject *</label>
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className={FIELD_CLASS}>
                <option value="">Select…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-text-primary">Grade *</label>
              <select value={grade} onChange={(e) => setGrade(e.target.value)} className={FIELD_CLASS}>
                <option value="">Select…</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                  <option key={g} value={String(g)}>
                    Grade {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DuplicateNotice
            matches={duplicates}
            isSuperAdmin={false}
            allowDuplicate={false}
            onAllowDuplicate={() => {}}
            onView={onView}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input label="Publisher" placeholder="e.g. Cambridge" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            <Input label="Academic Year" placeholder="e.g. 2025/2026" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-text-primary">
              Why does your school need it? *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. Our Grade 11 stream follows the IGCSE curriculum, which uses this book instead of the MoE one."
              className={`${FIELD_CLASS} text-sm placeholder:text-text-muted`}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-text-primary">
              Book file *<span className="ml-1 font-normal text-text-muted">(PDF, DOCX, DOC or EPUB, max 50 MB)</span>
            </label>
            <input
              key={fileKey}
              type="file"
              accept=".pdf,.docx,.doc,.epub,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/epub+zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full cursor-pointer text-sm text-text-secondary file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
            />
            {file && (
              <p className="mt-1 text-xs text-text-muted">
                {file.name} · {formatBytes(file.size)}
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" className="w-full gap-2" isLoading={submitting} disabled={submitting || !ready || blocked}>
            <Send className="h-4 w-4" />
            Submit for Approval
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Approval queue (super admin) ─────────────────────────

function ApprovalQueue({
  requests,
  textbooks,
  onChanged,
  onView,
}: {
  requests: TextbookListItem[];
  textbooks: TextbookListItem[];
  onChanged: () => void;
  onView: (id: string) => void;
}) {
  return (
    <Card className="border-warning/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-warning" />
          <h2 className="font-semibold text-text-primary">Approval requests</h2>
          <span className="rounded-full bg-warning/15 px-2 text-xs font-semibold text-warning">{requests.length}</span>
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          Schools&apos; uploads wait here. Nothing is processed — no AI chapter detection, embeddings or question
          generation — until you approve.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.map((r) => (
          <ApprovalRequestRow
            key={r.id}
            request={r}
            libraryMatch={textbooks.find(
              (tb) => tb.isLibrary && tb.id !== r.id && tb.grade === r.grade && subjectKey(tb.subject) === subjectKey(r.subject),
            )}
            onChanged={onChanged}
            onView={onView}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ApprovalRequestRow({
  request: r,
  libraryMatch,
  onChanged,
  onView,
}: {
  request: TextbookListItem;
  libraryMatch?: TextbookListItem;
  onChanged: () => void;
  onView: (id: string) => void;
}) {
  const [toLibrary, setToLibrary] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function review(decision: "approve" | "reject") {
    setBusy(decision);
    try {
      const res = await fetch(`/api/admin/textbooks/${r.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision === "approve" ? { decision, toLibrary } : { decision, note: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Review failed");
      toast.success(
        decision === "approve"
          ? data.processing
            ? `Approved "${r.title}" — detecting chapters in the background.`
            : `Approved "${r.title}".`
          : `Rejected "${r.title}". The school has been notified.`,
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-text-primary">{r.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1">
              <School className="h-3 w-3" />
              {r.schoolName ?? "Unknown school"}
            </span>
            <span>·</span>
            <span>
              Grade {r.grade} {r.subject}
            </span>
            {r.requestedBy && (
              <>
                <span>·</span>
                <span>by {r.requestedBy}</span>
              </>
            )}
            <span>·</span>
            <span>{new Date(r.createdAt).toLocaleDateString()}</span>
          </p>
        </div>
        {r.hasSourceFile && (
          <a
            href={`/api/admin/textbooks/${r.id}/source`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:border-primary/40"
          >
            <Download className="h-3.5 w-3.5" />
            {r.sourceFileName ?? "File"}
            {r.sourceFileSize ? <span className="text-text-muted">({formatBytes(r.sourceFileSize)})</span> : null}
          </a>
        )}
      </div>

      {r.requestNote && (
        <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-secondary">
          <span className="font-medium text-text-primary">Why they need it: </span>
          {r.requestNote}
        </p>
      )}

      {libraryMatch && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <Library className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The library already has{" "}
            <button type="button" onClick={() => onView(libraryMatch.id)} className="font-medium underline">
              {libraryMatch.title}
            </button>{" "}
            for Grade {libraryMatch.grade} {libraryMatch.subject} — approve only if this is genuinely a different book.
          </span>
        </p>
      )}

      {rejecting ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            autoFocus
            maxLength={1000}
            placeholder="Reason shown to the school, e.g. “Use the Grade 11 Chemistry book in the national library.”"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setRejecting(false)} disabled={!!busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-red-600 text-white hover:bg-red-700"
              isLoading={busy === "reject"}
              disabled={!!busy || !reason.trim()}
              onClick={() => review("reject")}
            >
              Reject request
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={toLibrary}
              onChange={(e) => setToLibrary(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            Add to the national library (every school gets it)
          </label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRejecting(true)} disabled={!!busy}>
              Reject
            </Button>
            <Button size="sm" className="gap-1.5" isLoading={busy === "approve"} disabled={!!busy} onClick={() => review("approve")}>
              <Check className="h-4 w-4" />
              Approve
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RetryIngestButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/admin/textbooks/${id}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: "retry" }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Retry failed");
          toast.success("Retrying chapter detection…");
          onDone();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Retry failed");
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline disabled:opacity-50"
    >
      <RotateCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
      Retry
    </button>
  );
}

// ─── Duplicate upload notice ──────────────────────────────

function DuplicateNotice({
  matches,
  isSuperAdmin,
  allowDuplicate,
  onAllowDuplicate,
  onView,
}: {
  matches: TextbookListItem[];
  isSuperAdmin: boolean;
  allowDuplicate: boolean;
  onAllowDuplicate: (v: boolean) => void;
  onView: (id: string) => void;
}) {
  if (matches.length === 0) return null;
  const first = matches[0];
  const qCount = totalQuestions(first);

  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        {first.isLibrary ? (
          <Library className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        ) : (
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text-primary">
            {first.isLibrary ? "Already in the national library" : "Your school already uploaded this"}
          </p>
          <p className="text-text-secondary">
            <button type="button" onClick={() => onView(first.id)} className="font-medium text-primary hover:underline">
              {first.title}
            </button>{" "}
            — Grade {first.grade} {first.subject}, {first._count.chapters} chapter
            {first._count.chapters !== 1 ? "s" : ""}, {qCount} question{qCount !== 1 ? "s" : ""}.{" "}
            {isSuperAdmin
              ? "Uploading again duplicates processing cost and splits the question bank."
              : first.isLibrary
                ? "Your students already have it — no upload needed. If your school uses a different book for this subject, contact the platform admin."
                : "Delete the existing one first if you want to replace it."}
          </p>
        </div>
      </div>
      {isSuperAdmin && (
        <label className="flex cursor-pointer items-center gap-2 pl-6 text-text-secondary">
          <input
            type="checkbox"
            checked={allowDuplicate}
            onChange={(e) => onAllowDuplicate(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          Upload another copy anyway (e.g. a new edition)
        </label>
      )}
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

/**
 * Attach / replace / remove the PDF students read in the Library. Independent
 * of processing: it never touches chapters, questions or embeddings.
 */
function ReaderPdfButton({ id, hasFile, size, onDone }: { id: string; hasFile: boolean; size: number | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/textbooks/${id}/reader`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success("Students can now read this book in the Library.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove this book from the student Library?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/textbooks/${id}/reader`, { method: "DELETE" });
      if (!res.ok) throw new Error("Remove failed");
      toast.success("Removed from the Library.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        className={cn(
          "flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          hasFile ? "bg-green-50 text-success hover:bg-green-100" : "text-text-muted hover:bg-primary/10 hover:text-primary",
        )}
        title={hasFile ? "Replace the PDF students read in the Library" : "Upload a PDF so students can read this book in the Library"}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Spinner size="sm" /> : <BookOpenText className="h-4 w-4" />}
        {hasFile ? `In Library${size ? ` · ${formatBytes(size)}` : ""}` : "Add to Library"}
      </button>
      {hasFile && !busy && (
        <button className="rounded p-1 text-text-muted hover:text-red-600" title="Remove from Library" onClick={remove}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
