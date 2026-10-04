"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Upload, GraduationCap, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";

interface ExamRow {
  id: string;
  subject: string;
  yearLabel: string;
  stream: string | null;
  durationMinutes: number;
  status: "EXTRACTING" | "REVIEW" | "PUBLISHED" | "FAILED";
  sourceFileName: string | null;
  extractionError: string | null;
  questionCount: number;
  attemptCount: number;
  needsReviewCount: number;
  createdAt: string;
}

const STATUS_BADGE: Record<ExamRow["status"], { label: string; variant: "info" | "warning" | "success" | "error" }> = {
  EXTRACTING: { label: "Reading PDF…", variant: "info" },
  REVIEW: { label: "In review", variant: "warning" },
  PUBLISHED: { label: "Published", variant: "success" },
  FAILED: { label: "Failed", variant: "error" },
};

const selectClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary";

/** Super admin: upload past national exam papers and follow them through review to publishing. */
export default function AdminNationalExamsPage() {
  const [exams, setExams] = useState<ExamRow[] | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [yearLabel, setYearLabel] = useState("");
  const [stream, setStream] = useState("");
  const [duration, setDuration] = useState("120");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/national-exams");
    if (r.ok) setExams((await r.json()).exams);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/subjects")
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((d) => setSubjects((d.subjects ?? []).map((s: { name: string }) => s.name)))
      .catch(() => {});
  }, [load]);

  // Poll while any paper is still being read.
  useEffect(() => {
    if (!exams?.some((e) => e.status === "EXTRACTING")) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [exams, load]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Choose the exam PDF.");
    if (!subject.trim() || !yearLabel.trim()) return toast.error("Subject and year are required.");
    const form = new FormData();
    form.append("file", file);
    form.append("subject", subject.trim());
    form.append("yearLabel", yearLabel.trim());
    form.append("stream", stream);
    form.append("durationMinutes", duration);
    setUploading(true);
    try {
      const r = await fetch("/api/admin/national-exams", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");
      toast.success("Uploaded. The questions are being read — this takes a few minutes.");
      setYearLabel("");
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
          <GraduationCap className="h-6 w-6 text-primary" /> National Exam Papers
        </h1>
        <p className="text-sm text-text-secondary">
          Upload past Grade 12 national exam PDFs. The questions and answers are read automatically, then you check
          them before publishing. Students practise them with no points involved.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader>
            <h2 className="flex items-center gap-2 font-semibold text-text-primary">
              <Upload className="h-5 w-5 text-primary" /> Upload a paper
            </h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={upload} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-text-muted">Exam PDF</label>
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="block w-full text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-text-muted">Subject</label>
                <Input list="exam-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Biology" />
                <datalist id="exam-subjects">
                  {subjects.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-text-muted">Year</label>
                <Input value={yearLabel} onChange={(e) => setYearLabel(e.target.value)} placeholder="e.g. 2016 E.C." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase text-text-muted">Stream</label>
                  <select value={stream} onChange={(e) => setStream(e.target.value)} className={selectClass}>
                    <option value="">Both / common</option>
                    <option value="NATURAL">Natural</option>
                    <option value="SOCIAL">Social</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase text-text-muted">Minutes</label>
                  <Input type="number" min={10} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} />
                </div>
              </div>
              <Button type="submit" className="w-full" isLoading={uploading}>
                Upload and read questions
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3 lg:col-span-2">
          {!exams ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" className="text-primary" />
            </div>
          ) : exams.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-text-secondary">No papers uploaded yet.</CardContent>
            </Card>
          ) : (
            exams.map((e) => (
              <Link key={e.id} href={`/admin/national-exams/${e.id}`}>
                <Card className="mb-3 transition-shadow hover:shadow-md">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-text-primary">
                          {e.subject} · {e.yearLabel}
                        </p>
                        {e.stream && <Badge variant="info">{e.stream === "NATURAL" ? "Natural" : "Social"}</Badge>}
                        <Badge variant={STATUS_BADGE[e.status].variant}>{STATUS_BADGE[e.status].label}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-text-secondary">
                        {e.questionCount} questions · {e.durationMinutes} min · {e.attemptCount} attempts
                        {e.sourceFileName ? ` · ${e.sourceFileName}` : ""}
                      </p>
                      {e.status === "FAILED" && e.extractionError && <p className="mt-1 text-xs text-error">{e.extractionError}</p>}
                    </div>
                    {e.needsReviewCount > 0 && e.status !== "EXTRACTING" && (
                      <span className="flex items-center gap-1 text-xs font-medium text-warning">
                        <AlertTriangle className="h-4 w-4" /> {e.needsReviewCount} to check
                      </span>
                    )}
                    {e.status === "EXTRACTING" && <Spinner size="sm" className="text-primary" />}
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
