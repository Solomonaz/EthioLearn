"use client";

import { FileText, ImageIcon, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The files attached to one submission.
 *
 * Shared by the student (who may withdraw one) and the teacher (who may only
 * read them). Downloads always go through the authorising route — there is no
 * static URL for a submission, by design.
 */

export interface SubmissionFileItem {
  id: string;
  originalName: string;
  sizeBytes: number;
  mimeType?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageName(name: string): boolean {
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
}

export function SubmissionFiles({
  files,
  onRemove,
  removingId,
  emptyLabel,
  className,
}: {
  files: SubmissionFileItem[];
  /** Omitted for a reader — the teacher never removes a student's work. */
  onRemove?: (fileId: string) => void;
  removingId?: string | null;
  emptyLabel?: string;
  className?: string;
}) {
  if (files.length === 0) {
    return emptyLabel ? (
      <p className={cn("text-xs text-text-muted", className)}>{emptyLabel}</p>
    ) : null;
  }

  return (
    <ul className={cn("space-y-1.5", className)}>
      {files.map((f) => {
        const Icon = isImageName(f.originalName) ? ImageIcon : FileText;
        const busy = removingId === f.id;
        return (
          <li
            key={f.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
          >
            <Icon className="h-4 w-4 shrink-0 text-text-muted" />
            <a
              href={`/api/submissions/files/${f.id}`}
              className="min-w-0 flex-1 truncate text-sm text-primary hover:underline"
              title={f.originalName}
            >
              {f.originalName}
            </a>
            <span className="shrink-0 text-[11px] text-text-muted">
              {formatBytes(f.sizeBytes)}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                disabled={busy}
                aria-label={`Remove ${f.originalName}`}
                className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-border/50 hover:text-red-600 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
