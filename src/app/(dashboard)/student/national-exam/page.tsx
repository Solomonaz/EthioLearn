"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Timer, BookOpenCheck, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface Paper {
  id: string;
  subject: string;
  yearLabel: string;
  stream: string | null;
  durationMinutes: number;
  questionCount: number;
  bestPercent: number | null;
  attemptCount: number;
}

type StreamFilter = "ALL" | "NATURAL" | "SOCIAL";

/** Grade 12 national exam: past papers grouped by subject, in exam or practice mode. No points. */
export default function NationalExamPage() {
  const t = useTranslations("nationalExam");
  const router = useRouter();
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [error, setError] = useState(false);
  const [stream, setStream] = useState<StreamFilter>("ALL");

  useEffect(() => {
    fetch("/api/national-exams")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPapers(d.exams))
      .catch(() => setError(true));
  }, []);

  const visible = useMemo(
    () => (papers ?? []).filter((p) => stream === "ALL" || !p.stream || p.stream === stream),
    [papers, stream],
  );
  const subjects = [...new Set(visible.map((p) => p.subject))];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
          <GraduationCap className="h-6 w-6 text-primary" /> {t("title")}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">{t("subtitle")}</p>
      </div>

      <div className="flex gap-2">
        {(["ALL", "NATURAL", "SOCIAL"] as StreamFilter[]).map((s) => (
          <Button key={s} size="sm" variant={stream === s ? "primary" : "outline"} onClick={() => setStream(s)}>
            {t(`stream_${s}`)}
          </Button>
        ))}
      </div>

      {error ? (
        <p className="text-text-secondary">{t("loadError")}</p>
      ) : !papers ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" className="text-primary" />
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto mb-3 h-12 w-12 text-text-secondary/40" />
            <p className="text-text-secondary">{t("empty")}</p>
          </CardContent>
        </Card>
      ) : (
        subjects.map((subject) => (
          <section key={subject} className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">{subject}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {visible
                .filter((p) => p.subject === subject)
                .map((p) => (
                  <Card key={p.id}>
                    <CardContent className="space-y-3 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-text-primary">{p.yearLabel}</p>
                        {p.stream && <Badge variant="info">{t(`stream_${p.stream}`)}</Badge>}
                        {p.bestPercent !== null && (
                          <Badge variant={p.bestPercent >= 50 ? "success" : "warning"}>{t("best", { percent: p.bestPercent })}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary">
                        {t("meta", { questions: p.questionCount, minutes: p.durationMinutes })}
                        {p.attemptCount > 0 ? ` · ${t("attempts", { count: p.attemptCount })}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => router.push(`/student/national-exam/${p.id}?mode=EXAM`)}>
                          <Timer className="mr-1 h-4 w-4" /> {t("examMode")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => router.push(`/student/national-exam/${p.id}?mode=PRACTICE`)}>
                          <BookOpenCheck className="mr-1 h-4 w-4" /> {t("practiceMode")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
