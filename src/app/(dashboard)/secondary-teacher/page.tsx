"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  GraduationCap,
  TrendingDown,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ClassInsight } from "@/types/secondary-teacher";
import { formatAccuracy, accuracyTone } from "@/lib/class-insights";

/**
 * Secondary teacher dashboard (grades 9-12).
 *
 * One card per class — a (subject, grade, section) triple — never a blended
 * average across them, because a grade 9 Maths section and a grade 10 Physics
 * section share neither students nor topics.
 */
export default function SecondaryTeacherDashboard() {
  const { data: session } = useSession();
  const teacherName = (session?.user as { name?: string } | undefined)?.name ?? "";

  const [classes, setClasses] = useState<ClassInsight[]>([]);
  const [windowDays, setWindowDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/secondary-teacher/classes");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load your classes");
      setClasses(data.classes ?? []);
      setWindowDays(data.windowDays ?? 90);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalStudents = classes.reduce((sum, c) => sum + c.studentCount, 0);
  const totalAnswers = classes.reduce((sum, c) => sum + c.answered, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          {teacherName ? `Welcome, ${teacherName}` : "Welcome"}
        </h1>
        <p className="text-sm text-text-secondary">
          How your grade 9-12 classes are doing over the last {windowDays} days.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" className="text-primary" />
        </div>
      ) : error ? (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-red-600">{error}</p>
          </CardContent>
        </Card>
      ) : classes.length === 0 ? (
        <Card>
          <CardContent>
            <div className="py-12 text-center">
              <GraduationCap className="mx-auto mb-3 h-10 w-10 text-text-muted" />
              <h2 className="font-semibold text-text-primary">
                No subjects assigned yet
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
                Add the subjects and grades you teach on your profile, or ask your
                school administrator to set them for you.
              </p>
              <Link
                href="/secondary-teacher/profile"
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
              >
                Go to profile <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Totals ─────────────────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryTile
              icon={<BookOpen className="h-5 w-5" />}
              label="Classes"
              value={String(classes.length)}
              hint="subject, grade and section"
            />
            <SummaryTile
              icon={<Users className="h-5 w-5" />}
              label="Students"
              value={String(totalStudents)}
              hint="across all your classes"
            />
            <SummaryTile
              icon={<TrendingDown className="h-5 w-5" />}
              label="Answers"
              value={String(totalAnswers)}
              hint={`in the last ${windowDays} days`}
            />
          </div>

          {/* ── One card per pair ──────────────────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-2">
            {classes.map((c) => (
              <Card key={c.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-text-primary">
                        {c.subject}
                      </h2>
                      <p className="text-xs text-text-muted">
                        Grade {c.grade}
                        {c.section ? ` · Section ${c.section}` : " · all sections"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
                        accuracyTone(c.accuracy),
                      )}
                    >
                      {formatAccuracy(c.accuracy)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <Stat label="Students" value={c.studentCount} />
                    <Stat label="Active" value={c.activeStudents} />
                    <Stat label="Answers" value={c.answered} />
                  </dl>

                  {c.studentCount === 0 ? (
                    <p className="mt-4 flex items-start gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      No students are registered in grade {c.grade}
                      {c.section ? ` section ${c.section}` : ""} at your school yet.
                    </p>
                  ) : c.weakChapters.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase text-text-muted">
                        Weakest chapters
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {c.weakChapters.slice(0, 3).map((ch) => (
                          <li
                            key={ch.id}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="min-w-0 truncate text-text-secondary">
                              {ch.chapterNumber}. {ch.title}
                            </span>
                            <span className="shrink-0 font-semibold text-text-primary">
                              {formatAccuracy(ch.accuracy)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-text-muted">
                      Not enough answers yet to spot weak chapters.
                    </p>
                  )}

                  <Link
                    href={`/secondary-teacher/classes?class=${c.id}`}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    View class <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-3 py-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold text-text-primary">{value}</p>
            <p className="text-xs text-text-secondary">{label}</p>
            <p className="text-[11px] text-text-muted">{hint}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-border/30 py-2">
      <dt className="text-[11px] uppercase text-text-muted">{label}</dt>
      <dd className="text-base font-bold text-text-primary">{value}</dd>
    </div>
  );
}
