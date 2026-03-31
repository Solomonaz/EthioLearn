"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_STORAGE_BYTES = 209715200; // 200 MB
const MAX_FILE_MB = 50;

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
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  uploadedById: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMB(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusBadgeVariant(
  status: ProcessingStatus,
): "default" | "info" | "success" | "error" {
  switch (status) {
    case "PENDING":
      return "default";
    case "PROCESSING":
      return "info";
    case "COMPLETED":
      return "success";
    case "FAILED":
      return "error";
  }
}

function statusLabel(status: ProcessingStatus): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "PROCESSING":
      return "Processing";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
  }
}

// ── Upload Modal ──────────────────────────────────────────────────────────────

interface UploadModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function UploadModal({ onClose, onSuccess }: UploadModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fileSizeMB, setFileSizeMB] = useState<string>("1");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Book title is required.");
      return;
    }

    const fileSizeNum = parseFloat(fileSizeMB);
    if (isNaN(fileSizeNum) || fileSizeNum <= 0) {
      toast.error("Please enter a valid file size.");
      return;
    }
    if (fileSizeNum > MAX_FILE_MB) {
      toast.error(`File size cannot exceed ${MAX_FILE_MB} MB.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/students/me/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || undefined,
          fileSize: Math.round(fileSizeNum * 1048576),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to upload book.");
        return;
      }

      toast.success(`"${trimmedTitle}" added to your library.`);
      onSuccess();
      onClose();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Upload Study Book
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal body */}
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {/* Title */}
          <div>
            <label
              htmlFor="book-title"
              className="mb-1 block text-sm font-medium text-text-primary"
            >
              Book Title <span className="text-error">*</span>
            </label>
            <input
              id="book-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Grade 11 Physics Textbook"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="book-desc"
              className="mb-1 block text-sm font-medium text-text-primary"
            >
              Description{" "}
              <span className="text-text-secondary font-normal">(optional)</span>
            </label>
            <textarea
              id="book-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this book..."
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {/* File info notice */}
          <div className="rounded-lg border border-border bg-gray-50 px-4 py-3 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Supported formats</p>
            <p className="mt-0.5">PDF files up to 50 MB &bull; EPUB up to 30 MB</p>
            <p className="mt-2 text-xs italic">
              In a full deployment, you would select a file here.
            </p>
          </div>

          {/* Simulated file size */}
          <div>
            <label
              htmlFor="file-size"
              className="mb-1 block text-sm font-medium text-text-primary"
            >
              Simulated File Size (MB){" "}
              <span className="text-text-secondary font-normal">max 50</span>
            </label>
            <input
              id="file-size"
              type="number"
              min={0.1}
              max={MAX_FILE_MB}
              step={0.1}
              value={fileSizeMB}
              onChange={(e) => setFileSizeMB(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              required
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? "Uploading..." : "Upload Book"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Book Card ─────────────────────────────────────────────────────────────────

interface BookCardProps {
  book: StudentBook;
}

function BookCard({ book }: BookCardProps) {
  const router = useRouter();

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="py-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="shrink-0 text-3xl leading-none" aria-hidden="true">
            📚
          </div>

          {/* Main content */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-text-primary truncate">
                {book.title}
              </p>
              <Badge variant={statusBadgeVariant(book.processingStatus)}>
                {statusLabel(book.processingStatus)}
              </Badge>
            </div>

            {book.description && (
              <p className="mt-1 text-xs text-text-secondary line-clamp-2">
                {book.description}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
              <span>{formatMB(book.storageBytes)} MB</span>
              <span>Uploaded {formatDate(book.createdAt)}</span>
            </div>
          </div>

          {/* Generate Quiz button */}
          {book.processingStatus === "COMPLETED" && (
            <div className="shrink-0">
              <Button
                size="sm"
                onClick={() => router.push("/student/quiz")}
              >
                Generate Quiz
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────

function BookSkeletonRow() {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
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
    setLoading(true);
    setError(null);
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

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  // Storage stats
  const usedBytes = books.reduce((sum, b) => sum + b.storageBytes, 0);
  const usedMB = parseFloat(formatMB(usedBytes));
  const totalMB = parseFloat(formatMB(MAX_STORAGE_BYTES));
  const storagePercent = Math.min(100, (usedBytes / MAX_STORAGE_BYTES) * 100);

  return (
    <>
      {showModal && (
        <UploadModal
          onClose={() => setShowModal(false)}
          onSuccess={fetchBooks}
        />
      )}

      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-text-primary">
            My Study Books
          </h1>
          <Button onClick={() => setShowModal(true)}>Upload Book</Button>
        </div>

        {/* Storage usage */}
        {!loading && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium text-text-primary">
                  Storage Usage
                </span>
                <span className="text-text-secondary">
                  {usedMB} MB / {totalMB} MB used
                </span>
              </div>
              <ProgressBar
                value={storagePercent}
                color={storagePercent >= 90 ? "secondary" : "primary"}
                size="sm"
              />
            </CardContent>
          </Card>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <BookSkeletonRow key={i} />
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <p className="text-text-secondary">{error}</p>
            <Button variant="outline" onClick={fetchBooks}>
              Try Again
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && books.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-4 text-5xl" aria-hidden="true">
                📚
              </div>
              <p className="text-lg font-medium text-text-primary">
                No books uploaded yet
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                Upload your first study book to generate personalized quizzes!
              </p>
              <Button className="mt-5" onClick={() => setShowModal(true)}>
                Upload Your First Book
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Books list */}
        {!loading && !error && books.length > 0 && (
          <div className="space-y-3">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
