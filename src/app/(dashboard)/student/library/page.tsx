"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Library, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";

interface Book {
  id: string;
  title: string;
  subject: string;
  grade: number;
  readerFileSize: number | null;
  chapterCount: number;
  hasPdf: boolean;
}

/** Library: the textbooks a student can open and read in the app. */
export default function LibraryPage() {
  const t = useTranslations("library");
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setBooks(d.books))
      .catch(() => setError(true));
  }, []);

  const grades = books ? [...new Set(books.map((b) => b.grade))].sort((a, b) => b - a) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
          <Library className="h-6 w-6 text-primary" /> {t("title")}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">{t("subtitle")}</p>
      </div>

      {error ? (
        <p className="text-text-secondary">{t("loadError")}</p>
      ) : !books ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" className="text-primary" />
        </div>
      ) : books.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BookOpen className="mx-auto mb-3 h-12 w-12 text-text-secondary/40" />
            <p className="text-text-secondary">{t("empty")}</p>
          </CardContent>
        </Card>
      ) : (
        grades.map((g) => (
          <section key={g} className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">{t("grade", { grade: g })}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {books
                .filter((b) => b.grade === g)
                .map((b) => (
                  <Link key={b.id} href={`/student/library/${b.id}`}>
                    <Card className="h-full transition-shadow hover:shadow-md">
                      <CardContent className="flex h-full flex-col gap-2 py-4">
                        <div className="flex h-24 items-center justify-center rounded-lg bg-primary/10">
                          <BookOpen className="h-10 w-10 text-primary" />
                        </div>
                        <p className="font-semibold text-text-primary">{b.subject}</p>
                        <p className="text-xs text-text-secondary">{t("grade", { grade: b.grade })}</p>
                        <p className="mt-auto text-xs text-text-secondary">
                          {b.hasPdf
                            ? `${t("pdf")}${b.readerFileSize ? ` · ${(b.readerFileSize / 1024 / 1024).toFixed(1)} MB` : ""}`
                            : `${t("text")}${b.chapterCount ? ` · ${t("chapters", { n: b.chapterCount })}` : ""}`}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
