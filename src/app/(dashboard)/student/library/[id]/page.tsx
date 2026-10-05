"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { PdfReader } from "@/components/student/pdf-reader";
import { TextReader } from "@/components/student/text-reader";
import { Spinner } from "@/components/ui/spinner";

/** Full-height reader for one textbook: its PDF when it has one, otherwise its chapter text. */
export default function ReadBookPage() {
  const t = useTranslations("library");
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState<string>("");
  // null until the library says which reader this book needs.
  const [hasPdf, setHasPdf] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const b = d?.books?.find((x: { id: string }) => x.id === id);
        if (b) setTitle(`${b.subject} · ${t("grade", { grade: b.grade })}`);
        setHasPdf(!!b?.hasPdf);
      })
      .catch(() => setHasPdf(false));
  }, [id, t]);

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Link href="/student/library" className="flex items-center gap-1 text-sm text-text-secondary hover:text-primary">
          <ChevronLeft className="h-4 w-4" /> {t("back")}
        </Link>
        <span className="truncate text-sm font-semibold text-text-primary">{title}</span>
      </div>
      {hasPdf === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="lg" className="text-primary" />
        </div>
      ) : hasPdf ? (
        <PdfReader url={`/api/textbooks/${id}/pdf`} storageKey={`reader-page-${id}`} />
      ) : (
        <TextReader bookId={id} />
      )}
    </div>
  );
}
