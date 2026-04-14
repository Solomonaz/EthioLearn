"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_STORAGE_BYTES = 209_715_200; // 200 MB
const MAX_FILE_BYTES = 52_428_800;     // 50 MB

// ── Types ─────────────────────────────────────────────────────────────────────

type ProcessingStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

interface StudentBook {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  processingStatus: ProcessingStatus;
  isPublic: boolean;
  storageBytes: number;
  quizCount: number;
  pointsAwarded: boolean;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  uploadedById: string;
}

interface GeneratedQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMB(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusBadgeVariant(status: ProcessingStatus): "default" | "info" | "success" | "error" {
  switch (status) {
    case "PENDING":    return "default";
    case "PROCESSING": return "info";
    case "COMPLETED":  return "success";
    case "FAILED":     return "error";
  }
}

function statusLabel(status: ProcessingStatus): string {
  switch (status) {
    case "PENDING":    return "Awaiting Upload";
    case "PROCESSING": return "Processing…";
    case "COMPLETED":  return "Ready";
    case "FAILED":     return "Failed";
  }
}

// ── Upload Modal ──────────────────────────────────────────────────────────────

interface UploadModalProps {
  totalUsedBytes: number;
  onClose: () => void;
  onSuccess: () => void;
}

function UploadModal({ totalUsedBytes, onClose, onSuccess }: UploadModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"form" | "uploading">("form");
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { toast.error("Book title is required."); return; }
    if (!file) { toast.error("Please select a file."); return; }
    if (file.size > MAX_FILE_BYTES) { toast.error("File exceeds 50 MB limit."); return; }
    if (totalUsedBytes + file.size > MAX_STORAGE_BYTES) {
      toast.error("Not enough storage. You have used most of your 200 MB quota.");
      return;
    }

    setStep("uploading");
    setProgress(15);

    try {
      // Step 1: Create book record
      const createRes = await fetch("/api/students/me/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || undefined,
          fileSize: file.size,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) { toast.error(createData.error ?? "Failed to create book record."); setStep("form"); return; }

      const bookId = createData.book.id;
      setProgress(35);

      // Step 2: Upload the actual file
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch(`/api/students/me/books/${bookId}/upload`, {
        method: "POST",
        body: formData,
      });
      setProgress(95);

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) { toast.error(uploadData.error ?? "Upload failed."); setStep("form"); return; }

      setProgress(100);
      toast.success(`"${trimmedTitle}" uploaded! +300 points awarded 🎉`);
      onSuccess();
      onClose();
    } catch {
      toast.error("Something went wrong. Please try again.");
      setStep("form");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-text-primary">Upload Study Book</h2>
          <button onClick={onClose} disabled={step === "uploading"}
            className="rounded-lg p-1 text-text-secondary hover:bg-gray-100 hover:text-text-primary disabled:opacity-40" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {step === "uploading" ? (
          <div className="flex flex-col items-center gap-4 px-6 py-10">
            <div className="text-4xl">📚</div>
            <p className="font-medium text-text-primary">Uploading &amp; processing…</p>
            <p className="text-xs text-text-secondary">AI is extracting content. This may take up to 30 seconds.</p>
            <div className="w-full"><ProgressBar value={progress} size="sm" /></div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
            <div>
              <label htmlFor="book-title" className="mb-1 block text-sm font-medium text-text-primary">
                Book Title <span className="text-error">*</span>
              </label>
              <input id="book-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Grade 11 Physics Textbook"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                required />
            </div>

            <div>
              <label htmlFor="book-desc" className="mb-1 block text-sm font-medium text-text-primary">
                Description <span className="text-text-secondary font-normal">(optional)</span>
              </label>
              <textarea id="book-desc" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this book…" rows={2}
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>

            {/* File picker */}
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                File <span className="text-error">*</span>
              </label>
              <div
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-5 transition-colors hover:border-primary/60 hover:bg-primary/5"
                onClick={() => fileRef.current?.click()}
              >
                <div className="text-2xl">📄</div>
                {file ? (
                  <div className="text-center">
                    <p className="text-sm font-medium text-text-primary truncate max-w-[240px]">{file.name}</p>
                    <p className="text-xs text-text-secondary">{formatMB(file.size)} MB</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm font-medium text-text-primary">Click to select file</p>
                    <p className="text-xs text-text-secondary">PDF, EPUB, or DOCX · max 50 MB</p>
                  </div>
                )}
                <input ref={fileRef} type="file" accept=".pdf,.epub,.docx,.doc" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
              </div>
              {file && file.size > MAX_FILE_BYTES && (
                <p className="mt-1 text-xs text-error">File exceeds 50 MB limit.</p>
              )}
            </div>

            <div className="rounded-lg bg-primary/5 px-4 py-3 text-sm text-primary">
              <p className="font-medium">🎁 Earn +300 points for each book you upload!</p>
              <p className="mt-0.5 text-xs opacity-80">Upload 3 books to unlock the Knowledge Sharer badge.</p>
            </div>

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={!file || !title.trim()}>Upload Book</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Quiz Generator Modal ──────────────────────────────────────────────────────

interface QuizModalProps { book: StudentBook; onClose: () => void; }

function QuizModal({ book, onClose }: QuizModalProps) {
  const [difficulty, setDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");
  const [questionCount, setQuestionCount] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState<GeneratedQuestion[] | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  async function handleGenerate() {
    setGenerating(true);
    setQuestions(null);
    try {
      const res = await fetch(`/api/students/me/books/${book.id}/generate-quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ difficulty, questionCount }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Generation failed"); return; }
      setQuestions(data.questions);
      setCurrentQ(0); setAnswers({}); setSubmitted(false);
    } catch {
      toast.error("Failed to generate quiz. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function handleSubmit() {
    if (!questions) return;
    let correct = 0;
    questions.forEach((q, i) => { if (answers[i] === q.correctAnswer) correct++; });
    setScore(Math.round((correct / questions.length) * 100));
    setSubmitted(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-full max-h-[620px] w-full max-w-lg flex-col rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-text-primary truncate max-w-[280px]">{book.title}</h2>
            <p className="text-xs text-text-secondary">Personal Book Quiz</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-text-secondary hover:bg-gray-100 hover:text-text-primary" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Setup */}
          {!questions && !generating && (
            <div className="space-y-5">
              <p className="text-sm text-text-secondary">Generate a quiz from your personal study book. Questions are AI-created from your content.</p>
              <div>
                <label className="mb-2 block text-sm font-medium text-text-primary">Difficulty</label>
                <div className="flex gap-2">
                  {(["EASY", "MEDIUM", "HARD"] as const).map((d) => (
                    <button key={d} onClick={() => setDifficulty(d)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                        difficulty === d ? "border-primary bg-primary text-white" : "border-border text-text-secondary hover:border-primary/50"
                      }`}>
                      {d.charAt(0) + d.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-text-primary">
                  Questions: <span className="text-primary font-bold">{questionCount}</span>
                </label>
                <input type="range" min={5} max={20} step={5} value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))} className="w-full accent-primary" />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                  {[5, 10, 15, 20].map((n) => <span key={n}>{n}</span>)}
                </div>
              </div>
              <Button className="w-full" onClick={handleGenerate}>Generate Quiz ✨</Button>
            </div>
          )}

          {/* Generating */}
          {generating && (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="text-4xl animate-bounce">🧠</div>
              <p className="font-medium text-text-primary">AI is creating your quiz…</p>
              <p className="text-sm text-text-secondary text-center">Generating {questionCount} questions from your book.</p>
            </div>
          )}

          {/* Quiz */}
          {questions && !submitted && (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span>Question {currentQ + 1} of {questions.length}</span>
                  <span>{difficulty.charAt(0) + difficulty.slice(1).toLowerCase()}</span>
                </div>
                <ProgressBar value={((currentQ + 1) / questions.length) * 100} size="sm" />
              </div>
              <p className="text-sm font-medium text-text-primary leading-relaxed">{questions[currentQ].question}</p>
              <div className="space-y-2">
                {questions[currentQ].options.map((opt) => (
                  <button key={opt} onClick={() => setAnswers((prev) => ({ ...prev, [currentQ]: opt }))}
                    className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-all ${
                      answers[currentQ] === opt
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border text-text-primary hover:border-primary/40 hover:bg-gray-50"
                    }`}>
                    {opt}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                {currentQ < questions.length - 1 ? (
                  <Button className="flex-1" disabled={!answers[currentQ]}
                    onClick={() => setCurrentQ((q) => q + 1)}>Next →</Button>
                ) : (
                  <Button className="flex-1"
                    disabled={Object.keys(answers).length < questions.length}
                    onClick={handleSubmit}>Submit Quiz</Button>
                )}
              </div>
            </div>
          )}

          {/* Results */}
          {submitted && questions && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-5xl mb-2">{score >= 80 ? "🏆" : score >= 60 ? "🎯" : "📚"}</div>
                <p className="text-2xl font-bold text-text-primary">{score}%</p>
                <p className="text-sm text-text-secondary mt-1">
                  {Object.entries(answers).filter(([i, a]) => a === questions[Number(i)].correctAnswer).length} / {questions.length} correct
                </p>
              </div>
              <div className="space-y-3">
                {questions.map((q, i) => {
                  const isCorrect = answers[i] === q.correctAnswer;
                  return (
                    <div key={i} className={`rounded-lg border p-3 text-sm ${isCorrect ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                      <p className="font-medium text-text-primary mb-1">{q.question}</p>
                      <p className={isCorrect ? "text-green-700" : "text-red-700"}>
                        {isCorrect ? "✓" : "✗"} {answers[i] ?? "No answer"}
                      </p>
                      {!isCorrect && <p className="text-green-700 text-xs mt-1">Correct: {q.correctAnswer}</p>}
                      {q.explanation && <p className="text-text-secondary text-xs mt-1 italic">{q.explanation}</p>}
                    </div>
                  );
                })}
              </div>
              <Button className="w-full" variant="outline"
                onClick={() => { setQuestions(null); setSubmitted(false); }}>
                Try Another Quiz
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Book Card ─────────────────────────────────────────────────────────────────

function BookCard({ book }: { book: StudentBook }) {
  const [showQuiz, setShowQuiz] = useState(false);
  return (
    <>
      {showQuiz && <QuizModal book={book} onClose={() => setShowQuiz(false)} />}
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0 text-3xl leading-none" aria-hidden="true">📚</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-text-primary truncate">{book.title}</p>
                <Badge variant={statusBadgeVariant(book.processingStatus)}>{statusLabel(book.processingStatus)}</Badge>
                {book.pointsAwarded && <Badge variant="success" className="text-[10px]">+300 pts</Badge>}
              </div>
              {book.description && <p className="mt-1 text-xs text-text-secondary line-clamp-2">{book.description}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                <span>{formatMB(book.storageBytes)} MB</span>
                {book.quizCount > 0 && <span>{book.quizCount} quiz{book.quizCount !== 1 ? "zes" : ""} generated</span>}
                <span>Uploaded {formatDate(book.createdAt)}</span>
              </div>
            </div>
            {book.processingStatus === "COMPLETED" && (
              <Button size="sm" className="shrink-0" onClick={() => setShowQuiz(true)}>Generate Quiz</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function BookSkeletonRow() {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-2/5" /><Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StudentBooksPage() {
  const [books, setBooks] = useState<StudentBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const fetchBooks = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/students/me/books");
      if (!res.ok) throw new Error("Failed to load books");
      const data = await res.json();
      setBooks(data.books ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBooks(); }, [fetchBooks]);

  const usedBytes = books.reduce((sum, b) => sum + b.storageBytes, 0);
  const storagePercent = Math.min(100, (usedBytes / MAX_STORAGE_BYTES) * 100);

  return (
    <>
      {showModal && (
        <UploadModal totalUsedBytes={usedBytes} onClose={() => setShowModal(false)} onSuccess={fetchBooks} />
      )}
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">My Study Books</h1>
            <p className="text-sm text-text-secondary">Upload books and generate personalized AI quizzes</p>
          </div>
          <Button onClick={() => setShowModal(true)}>+ Upload Book</Button>
        </div>

        {!loading && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium text-text-primary">Storage Usage</span>
                <span className="text-text-secondary">
                  {formatMB(usedBytes)} MB / {formatMB(MAX_STORAGE_BYTES)} MB
                </span>
              </div>
              <ProgressBar value={storagePercent} color={storagePercent >= 90 ? "secondary" : "primary"} size="sm" />
              {storagePercent >= 90 && (
                <p className="mt-2 text-xs text-error">Running low on storage. Consider removing older books.</p>
              )}
            </CardContent>
          </Card>
        )}

        {!loading && books.length === 0 && !error && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: "📤", title: "Upload", desc: "PDF, EPUB or DOCX up to 50 MB" },
              { icon: "🤖", title: "AI Processing", desc: "Content extracted & analyzed automatically" },
              { icon: "🎮", title: "Generate Quiz", desc: "Get personalized questions from your book" },
            ].map(({ icon, title, desc }) => (
              <Card key={title}><CardContent className="py-4 text-center">
                <div className="text-2xl mb-2">{icon}</div>
                <p className="text-sm font-semibold text-text-primary">{title}</p>
                <p className="mt-1 text-xs text-text-secondary">{desc}</p>
              </CardContent></Card>
            ))}
          </div>
        )}

        {loading && (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <BookSkeletonRow key={i} />)}</div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <p className="text-text-secondary">{error}</p>
            <Button variant="outline" onClick={fetchBooks}>Try Again</Button>
          </div>
        )}

        {!loading && !error && books.length === 0 && (
          <Card><CardContent className="py-16 text-center">
            <div className="mx-auto mb-4 text-5xl" aria-hidden="true">📚</div>
            <p className="text-lg font-medium text-text-primary">No books uploaded yet</p>
            <p className="mt-1 text-sm text-text-secondary">Upload your first study book to generate personalized quizzes!</p>
            <p className="mt-1 text-xs text-primary font-medium">🎁 Earn +300 points per book uploaded</p>
            <Button className="mt-5" onClick={() => setShowModal(true)}>Upload Your First Book</Button>
          </CardContent></Card>
        )}

        {!loading && !error && books.length > 0 && (
          <div className="space-y-3">{books.map((book) => <BookCard key={book.id} book={book} />)}</div>
        )}
      </div>
    </>
  );
}
