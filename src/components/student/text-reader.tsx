"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface ChapterRef {
  chapterNumber: number;
  title: string;
}

interface ChapterText extends ChapterRef {
  content: string | null;
}

/**
 * Reads a textbook chapter by chapter from its stored text — for books that
 * have no reader PDF (most uploads keep only the extracted text). The open
 * chapter is remembered per book, like the PDF reader's page.
 */
export function TextReader({ bookId }: { bookId: string }) {
  const t = useTranslations("library");
  const storageKey = `reader-chapter-${bookId}`;
  const [chapters, setChapters] = useState<ChapterRef[] | null>(null);
  const [chapter, setChapter] = useState<ChapterText | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (n?: number) => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/textbooks/${bookId}/text${n ? `?chapter=${n}` : ""}`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        setChapters(d.chapters);
        setChapter(d.chapter);
        if (d.chapter) {
          try {
            localStorage.setItem(storageKey, String(d.chapter.chapterNumber));
          } catch {
            /* storage unavailable */
          }
        }
        scrollRef.current?.scrollTo({ top: 0 });
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [bookId, storageKey],
  );

  useEffect(() => {
    let saved: number | undefined;
    try {
      saved = Number(localStorage.getItem(storageKey)) || undefined;
    } catch {
      /* storage unavailable */
    }
    load(saved);
  }, [load, storageKey]);

  const idx = chapters && chapter ? chapters.findIndex((c) => c.chapterNumber === chapter.chapterNumber) : -1;
  const prev = idx > 0 ? chapters![idx - 1] : null;
  const next = chapters && idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;

  if (error) return <p className="p-6 text-center text-text-secondary">{t("loadError")}</p>;
  if (!chapters) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }
  if (chapters.length === 0) return <p className="p-6 text-center text-text-secondary">{t("noText")}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-surface px-3 py-2">
        <label htmlFor="reader-chapter" className="sr-only">
          {t("chapter")}
        </label>
        <select
          id="reader-chapter"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-base outline-none focus:ring-2 focus:ring-primary/20 sm:text-sm"
          value={chapter?.chapterNumber ?? ""}
          onChange={(e) => load(Number(e.target.value))}
        >
          {chapters.map((c) => (
            <option key={c.chapterNumber} value={c.chapterNumber}>
              {t("chapterN", { n: c.chapterNumber })}: {c.title}
            </option>
          ))}
        </select>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-background">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" className="text-primary" />
          </div>
        ) : chapter ? (
          <article className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {t("chapterN", { n: chapter.chapterNumber })}
            </p>
            <h2 className="mb-5 mt-1 text-xl font-bold text-text-primary sm:text-2xl">{chapter.title}</h2>
            <div className="whitespace-pre-line break-words text-[15px] leading-7 text-text-primary sm:text-base">
              {chapter.content?.trim() || t("noText")}
            </div>
            <div className="mt-10 flex items-center justify-between gap-3 border-t border-border pt-4">
              {prev ? (
                <Button variant="outline" size="sm" onClick={() => load(prev.chapterNumber)}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> {t("chapterN", { n: prev.chapterNumber })}
                </Button>
              ) : (
                <span />
              )}
              {next && (
                <Button size="sm" onClick={() => load(next.chapterNumber)}>
                  {t("chapterN", { n: next.chapterNumber })} <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}
