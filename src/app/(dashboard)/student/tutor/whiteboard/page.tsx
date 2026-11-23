"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Camera, FileText, History, ImagePlus, PenLine, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MathText } from "@/components/ui/math-text";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import { GuideSays } from "@/components/student/guide-mascot";
import {
  primeSpeech,
  savedUploads,
  WhiteboardTutor,
  type LessonRequest,
  type SavedUpload,
} from "@/components/student/whiteboard-tutor";
import { useEntitlements } from "@/hooks/use-entitlements";

interface Mistake {
  quizId: string;
  questionId: string;
  questionText: string;
  studentAnswer: string;
  correctAnswer: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  completedAt: string;
}

interface Picked {
  dataUrl: string;
  mimeType: string;
  name: string;
  size: number;
  /** Object URL for the image preview. */
  preview: string | null;
}

const MAX_BYTES = 4 * 1024 * 1024; // matches the server
const MAX_SIDE = 1600;

/** Shrink a photo to at most 1600 px a side as JPEG — enough to read, light on data. */
function compressImage(file: File): Promise<Picked> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ dataUrl, mimeType: "image/jpeg", name: file.name, size: Math.round((dataUrl.length * 3) / 4), preview: url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * /student/tutor/whiteboard — the Whiteboard, in the AI Study menu. The
 * Abugida guide explains, out loud on a whiteboard, either a photo/PDF of
 * schoolwork the student sends or one of their recent wrong quiz answers.
 */
export default function WhiteboardPage() {
  const t = useTranslations("whiteboard");
  const ent = useEntitlements();
  const [mistakes, setMistakes] = useState<Mistake[] | null>(null);
  const [uploads, setUploads] = useState<SavedUpload[]>([]);
  const [open, setOpen] = useState<{ request: LessonRequest; studentAnswer?: string } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [note, setNote] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const allowed = ent.ai && ent.aiFeatures.aiTutor;

  useEffect(() => {
    if (ent.loading || !allowed) return;
    setUploads(savedUploads());
    fetch("/api/ai/why-wrong/recent")
      .then((r) => (r.ok ? r.json() : { mistakes: [] }))
      .then((d) => setMistakes(d.mistakes ?? []))
      .catch(() => setMistakes([]));
  }, [ent.loading, allowed]);

  if (!ent.loading && !allowed) {
    return <UpgradeNotice feature="AI Study" planName={ent.planName} description={t("pitch")} />;
  }

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    setReading(true);
    try {
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        if (file.size > MAX_BYTES) throw new Error(t("tooBig"));
        setPicked({ dataUrl: await readAsDataUrl(file), mimeType: "application/pdf", name: file.name, size: file.size, preview: null });
      } else if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
        const img = await compressImage(file).catch(() => {
          throw new Error(t("cantReadPhoto"));
        });
        if (img.size > MAX_BYTES) throw new Error(t("tooBig"));
        setPicked(img);
      } else {
        throw new Error(t("wrongType"));
      }
    } catch (e) {
      setPicked(null);
      setFileError(e instanceof Error ? e.message : t("wrongType"));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  function clearPicked() {
    if (picked?.preview) URL.revokeObjectURL(picked.preview);
    setPicked(null);
    setNote("");
  }

  function explainUpload() {
    if (!picked) return;
    primeSpeech();
    setOpen({
      request: {
        kind: "upload",
        key: `upload-${Date.now().toString(36)}`,
        file: picked.dataUrl,
        mimeType: picked.mimeType,
        note: note.trim(),
      },
    });
    clearPicked();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-1 sm:p-2">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <PenLine className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-primary">{t("title")}</h1>
          <p className="text-sm text-text-secondary">{t("pageIntro")}</p>
        </div>
      </div>

      {/* ── Upload a photo or PDF ─────────────────────────────── */}
      <Card className="overflow-hidden border-primary/30">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <GuideSays expression="happy" size={64}>{t("uploadIntro")}</GuideSays>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
            data-testid="wb-file"
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />

          {!picked ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={reading}
                className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-primary-dark disabled:opacity-60"
              >
                <Camera className="h-5 w-5" /> {t("takePhoto")}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={reading}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 px-4 py-3 text-sm font-bold text-primary hover:bg-primary/5 disabled:opacity-60"
                data-testid="wb-choose"
              >
                {reading ? <Spinner size="sm" /> : <ImagePlus className="h-5 w-5" />} {t("chooseFile")}
              </button>
              <p className="text-xs text-text-muted sm:col-span-2">{t("fileLimits")}</p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="wb-picked">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2">
                {picked.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={picked.preview} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-error/10 text-error">
                    <FileText className="h-7 w-7" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">{picked.name}</p>
                  <p className="text-xs text-text-muted">{Math.max(1, Math.round(picked.size / 1024))} KB</p>
                </div>
                <button
                  type="button"
                  onClick={clearPicked}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-border/50"
                  aria-label={t("remove")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-text-secondary">{t("noteLabel")}</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 300))}
                  rows={2}
                  placeholder={t("notePlaceholder")}
                  className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-base text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:text-sm"
                  data-testid="wb-note"
                />
              </label>
              <button
                type="button"
                onClick={explainUpload}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-primary-dark"
                data-testid="wb-upload-explain"
              >
                <PenLine className="h-5 w-5" /> {t("explain")}
              </button>
              <p className="text-center text-xs text-text-muted">{t("usesMessage")}</p>
            </div>
          )}
          {fileError && <p className="text-sm text-error" data-testid="wb-file-error">{fileError}</p>}
        </CardContent>
      </Card>

      {/* ── Past uploads, replayable for free ─────────────────── */}
      {uploads.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-text-muted">
            <History className="h-4 w-4" /> {t("recentBoards")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {uploads.map((u) => (
              <button
                key={u.key}
                type="button"
                onClick={() => {
                  primeSpeech();
                  setOpen({ request: { kind: "saved", key: u.key } });
                }}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary hover:border-primary/40 hover:bg-primary/5"
              >
                <PenLine className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{u.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent wrong quiz answers ─────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-text-primary">{t("mistakesTitle")}</h2>
        {mistakes === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : mistakes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <GuideSays expression="proud" size={72}>{t("emptyTitle")}</GuideSays>
              <p className="max-w-sm text-sm text-text-secondary">{t("emptyText")}</p>
              <Link href="/student/quiz" className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark">
                {t("startQuiz")}
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <GuideSays expression="sassy" size={60}>{t("listIntro", { count: mistakes.length })}</GuideSays>
            <div className="space-y-3">
              {mistakes.map((m) => (
                <Card key={`${m.quizId}-${m.questionId}`} className="overflow-hidden border-l-4 border-l-error">
                  <CardContent className="space-y-2 py-3">
                    <p className="text-xs font-medium text-text-muted">
                      {m.subject} · {t("gradeN", { n: m.grade })} · {m.chapterTitle}
                    </p>
                    <p className="text-sm font-medium text-text-primary">
                      <MathText text={m.questionText} />
                    </p>
                    <p className="text-xs text-text-secondary">
                      {t("youAnswered")}{" "}
                      <span className="font-semibold text-error line-through">
                        <MathText text={m.studentAnswer || "—"} />
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        primeSpeech();
                        setOpen({
                          request: { kind: "mistake", quizId: m.quizId, questionId: m.questionId },
                          studentAnswer: m.studentAnswer,
                        });
                      }}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
                      data-testid="wb-explain"
                    >
                      <PenLine className="h-4 w-4" /> {t("explain")}
                    </button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </section>

      {open && (
        <WhiteboardTutor
          request={open.request}
          studentAnswer={open.studentAnswer}
          onClose={() => {
            setOpen(null);
            setUploads(savedUploads());
          }}
        />
      )}
    </div>
  );
}
