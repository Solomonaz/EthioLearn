"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Layers,
  Zap,
  Hash,
  CheckCircle,
  Shuffle,
  Clock,
  Timer,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { useQuizStore } from "@/stores/quiz-store";
import { useEntitlements } from "@/hooks/use-entitlements";
import { cn, buildQuickPresets } from "@/lib/utils";
import { getStudyScope, isExamGrade } from "@/lib/grade-scope";

interface Textbook {
  id: string;
  title: string;
  subject: string;
  grade: number;
  _count: { chapters: number };
}

// Per-difficulty → per-type PUBLISHED question counts, e.g. { EASY: { MCQ: 4 } }.
type DiffTypeCounts = Record<string, Record<string, number>>;

interface Chapter {
  id: string;
  title: string;
  chapterNumber: number;
  _count: { questions: number };
  difficultyCounts: { EASY: number; MEDIUM: number; HARD: number };
  difficultyTypeCounts?: DiffTypeCounts;
}

type Difficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED" | "ADAPTIVE";
type QuizMode = "SOLO" | "TIMED";

const STEPS = ["Subject", "Source", "Chapter", "Difficulty", "Types", "Questions", "Mode", "Review"];
const TYPE_KEYS = [
  { value: "MCQ",           labelKey: "multipleChoice", icon: Layers },
  { value: "TRUE_FALSE",    labelKey: "trueFalse",      icon: CheckCircle },
  { value: "FILL_IN_BLANK", labelKey: "fillInBlank",    icon: Sparkles },
  { value: "MATCH_PAIRS",   labelKey: "matchPairs",     icon: Shuffle },
  { value: "ORDERING",      labelKey: "ordering",       icon: Layers },
] as const;
const QUESTION_COUNTS = [5, 10, 15, 20];

const DIFFICULTY_KEYS: {
  value: Difficulty;
  labelKey: string;
  descKey: string;
  badgeVariant: "difficulty-easy" | "difficulty-medium" | "difficulty-hard" | "info";
  borderColor: string;
}[] = [
  { value: "EASY",     labelKey: "easy",            descKey: "easyDesc",     badgeVariant: "difficulty-easy",   borderColor: "border-green-400" },
  { value: "MEDIUM",   labelKey: "medium",          descKey: "mediumDesc",   badgeVariant: "difficulty-medium", borderColor: "border-yellow-400" },
  { value: "HARD",     labelKey: "hard",            descKey: "hardDesc",     badgeVariant: "difficulty-hard",   borderColor: "border-red-400" },
  { value: "ADAPTIVE", labelKey: "aiAdaptiveLabel", descKey: "adaptiveDesc", badgeVariant: "info",              borderColor: "border-purple-400" },
  { value: "MIXED",    labelKey: "mixed",           descKey: "mixedDesc",    badgeVariant: "info",              borderColor: "border-blue-400" },
];

const SOURCE_KEYS = [
  { value: "BANK" as const, labelKey: "questionBankSource", descKey: "questionBankDesc", icon: Layers },
  { value: "AI"   as const, labelKey: "aiGenerationSource", descKey: "aiGenerationDesc", icon: Sparkles },
];

export default function QuizLauncherPage() {
  const { data: session, status: sessionStatus } = useSession();
  const ent = useEntitlements();
  const t  = useTranslations("quiz");
  const tc = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const startQuiz = useQuizStore((s) => s.startQuiz);

  const [step, setStep] = useState(0);
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loadingTextbooks, setLoadingTextbooks] = useState(true);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [textbookTotals, setTextbookTotals] = useState<{
    totalQuestions: number;
    difficultyCounts: { EASY: number; MEDIUM: number; HARD: number };
    difficultyTypeCounts?: DiffTypeCounts;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adaptiveInsights, setAdaptiveInsights] = useState<{
    difficulty: string;
    weightedAccuracy: number;
    quizzesAnalyzed: number;
    reasoning: string;
    trend: "improving" | "declining" | "stable";
  } | null>(null);

  // Selections
  const [selectedTextbook, setSelectedTextbook] = useState<Textbook | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | "all" | null>(null);
  const [selectedSource, setSelectedSource] = useState<"BANK" | "AI">("BANK");
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["MCQ"]);
  const [selectedCount, setSelectedCount] = useState<number | null>(null);
  const [selectedMode, setSelectedMode] = useState<QuizMode>("SOLO");

  // ── Grade scope (see lib/grade-scope) ──────────────────────────────────────
  // Exam grades study across their whole cycle: grade 8 sits an exam drawn from
  // grades 7–8, grade 12 from grades 9–12. Show a chip per grade in scope,
  // defaulted to the student's own grade so nothing changes for everyone else.
  const userGrade = (session?.user as { grade?: number | null } | undefined)?.grade ?? null;
  const studyScope = getStudyScope(userGrade);
  const [gradeFilter, setGradeFilter] = useState<number | null>(null);

  // Default the chip to the student's own grade once the session resolves.
  useEffect(() => {
    if (userGrade != null && gradeFilter === null) setGradeFilter(userGrade);
  }, [userGrade, gradeFilter]);

  const visibleTextbooks =
    gradeFilter == null
      ? textbooks
      : textbooks.filter((tb) => tb.grade === gradeFilter);

  // Fetch textbooks on mount — wait for full session auth before reading grade
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    async function fetchTextbooks() {
      try {
        // No grade param — the API returns the student's whole study scope
        // (their grade plus the lower grades of the same exam cycle). The
        // grade chips below narrow it client-side.
        const res = await fetch(`/api/textbooks`);
        if (!res.ok) throw new Error("Failed to load subjects");
        const data = await res.json();
        setTextbooks(data.textbooks ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load subjects");
      } finally {
        setLoadingTextbooks(false);
      }
    }
    fetchTextbooks();
  }, [sessionStatus, session]);

  // Fetch chapters when textbook selected
  useEffect(() => {
    if (!selectedTextbook) return;
    async function fetchChapters() {
      setLoadingChapters(true);
      try {
        const res = await fetch(
          `/api/textbooks/${selectedTextbook!.id}/chapters`
        );
        if (!res.ok) throw new Error("Failed to load chapters");
        const data = await res.json();
        setChapters(data.chapters);
        setTextbookTotals(data.textbookTotals);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load chapters");
      } finally {
        setLoadingChapters(false);
      }
    }
    fetchChapters();
  }, [selectedTextbook]);

  // Auto-launch daily challenge when URL params are present
  useEffect(() => {
    const challengeChapterId = searchParams.get("chapterId");
      const isChallenge = searchParams.get("challenge") === "true";
      const count = parseInt(searchParams.get("count") || "5", 10);
      if (!isChallenge || !challengeChapterId) return;
  
      async function launchChallenge() {
        setGenerating(true);
        setError(null);
        try {
          const res = await fetch("/api/quizzes/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chapterId: challengeChapterId,
              difficulty: "MIXED",
              questionCount: count,
              mode: "SOLO",
              isDailyChallenge: true, // Mark it as a challenge
            }),
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to generate quiz");
          }
          const data = await res.json();
          startQuiz(data.quizId, data.questions, "SOLO");
          
          // REMOVED premature points award POST call
          
          router.push(`/student/quiz/${data.quizId}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to start challenge");
          setGenerating(false);
        }
      }
    launchChallenge();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-launch a practice quiz from a "Practice this chapter" recommendation link
  useEffect(() => {
    const reviewChapterId = searchParams.get("chapterId");
    const isReview = searchParams.get("review") === "true";
    if (!isReview || !reviewChapterId) return;

    async function launchReview() {
      setGenerating(true);
      setError(null);
      try {
        const res = await fetch("/api/quizzes/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chapterId: reviewChapterId,
            difficulty: "MIXED",
            questionCount: 10,
            mode: "SOLO",
            isDailyChallenge: false,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to generate practice quiz");
        }
        const data = await res.json();
        startQuiz(data.quizId, data.questions, "SOLO");
        router.push(`/student/quiz/${data.quizId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start practice quiz");
        setGenerating(false);
      }
    }
    launchReview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStartQuiz() {
    if (!selectedTextbook || !selectedChapter || !selectedDifficulty || !selectedCount) return;

    setGenerating(true);
    setError(null);

    try {
      const endpoint = selectedSource === "AI" ? "/api/quizzes/generate-ai" : "/api/quizzes/generate";
      const body = {
        textbookId: selectedTextbook.id,
        chapterId: selectedChapter === "all" ? "all" : selectedChapter.id,
        difficulty: selectedDifficulty,
        questionCount: selectedCount,
        questionTypes: selectedTypes,
        mode: selectedMode,
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate quiz");
      }

      const data = await res.json();
      if (data.adaptiveInsights) {
        setAdaptiveInsights(data.adaptiveInsights);
      }
      // `shortfallReason` is set when the independent solver rejected some
      // questions, so the quiz is shorter than the student asked for.
      startQuiz(
        data.quizId,
        data.questions,
        data.mode ?? selectedMode,
        data.deliveredQuestions < data.requestedQuestions ? data.shortfallReason : null
      );
      router.push(`/student/quiz/${data.quizId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate quiz");
      setGenerating(false);
    }
  }

  function goBack() {
    if (step === 0) {
      router.push("/student");
    } else {
      setStep(step - 1);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      {/* Step Indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
          >
            <ChevronLeft className="h-4 w-4" />
            {tc("back")}
          </button>
          <p className="text-sm text-text-secondary">
            {t("stepN", { step: step + 1, total: STEPS.length })}
          </p>
        </div>
        <h1 className="mt-2 text-xl font-bold text-text-primary">
          {step === 0 && t("selectSubjectTitle")}
          {step === 1 && t("questionSourceTitle")}
          {step === 2 && t("selectChapterTitle")}
          {step === 3 && t("chooseDifficultyTitle")}
          {step === 4 && t("questionTypesTitle")}
          {step === 5 && t("howManyTitle")}
          {step === 6 && t("chooseModeTitle")}
          {step === 7 && t("reviewStart")}
        </h1>

        <div className="mt-3 flex gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i <= step ? "bg-primary" : "bg-gray-200"
              )}
            />
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Step 1: Select Subject */}
      {step === 0 && (
        <div className="space-y-3">
          {/* Grade chips — only shown when the student's exam cycle spans more
              than one grade (i.e. every grade except the first of a cycle). */}
          {studyScope.length > 1 && !loadingTextbooks && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {studyScope.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setGradeFilter(g);
                      setSelectedTextbook(null);
                      setSelectedChapter(null);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      gradeFilter === g
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary",
                    )}
                  >
                    Grade {g}
                    {g === userGrade && (
                      <span className="ml-1 opacity-70">&middot; yours</span>
                    )}
                  </button>
                ))}
              </div>
              {isExamGrade(userGrade) && (
                <p className="text-xs text-text-secondary">
                  Your Grade {userGrade} exam draws from Grade{" "}
                  {studyScope[0]}&ndash;{userGrade}, so all of it is here.
                </p>
              )}
            </div>
          )}

          {loadingTextbooks ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" className="text-primary" />
            </div>
          ) : visibleTextbooks.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <BookOpen className="mx-auto mb-2 h-10 w-10 text-text-secondary/40" />
                <p className="text-text-secondary">
                  {t("noSubjects")}
                </p>
              </CardContent>
            </Card>
          ) : (
            visibleTextbooks.map((tb) => (
              <Card
                key={tb.id}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  selectedTextbook?.id === tb.id &&
                    "border-primary ring-2 ring-primary/20"
                )}
                onClick={() => {
                  setSelectedTextbook(tb);
                  setSelectedChapter(null);
                  setStep(1);
                }}
              >
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="rounded-lg bg-primary/10 p-3">
                    <BookOpen className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-text-primary">
                      {tb.subject}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {tb.title} &middot; Grade {tb.grade}
                    </p>
                  </div>
                  <Badge>{t("chapters", { count: tb._count.chapters })}</Badge>
                  <ChevronRight className="h-5 w-5 text-text-secondary" />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Step 2: Select Source */}
      {step === 1 && (
        <div className="grid gap-4">
          {/* AI-generated quizzes: need both the user's AI access AND the feature on. */}
          {SOURCE_KEYS.filter((s) => s.value !== "AI" || (ent.ai && ent.aiFeatures.aiQuizGen)).map((src) => {
            const Icon = src.icon;
            return (
              <Card
                key={src.value}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  selectedSource === src.value &&
                    "border-primary ring-2 ring-primary/20"
                )}
                onClick={() => {
                  setSelectedSource(src.value);
                  setStep(2);
                }}
              >
                <CardContent className="flex items-center gap-4 py-5">
                  <div className={cn(
                    "rounded-xl p-3",
                    src.value === "AI" ? "bg-primary/10 text-primary" : "bg-gray-100 text-gray-600"
                  )}>
                    <Icon className="h-7 w-7" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-text-primary">{t(src.labelKey as any)}</p>
                      {src.value === "AI" && (
                        <Badge className="bg-primary/10 text-primary border-none text-[10px] uppercase">New</Badge>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary">
                      {t(src.descKey as any)}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-border" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Step 3: Select Chapter */}
      {step === 2 && (
        <div className="space-y-2">
          {loadingChapters ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" className="text-primary" />
            </div>
          ) : (
            <>
              {/* All Chapters Selection */}
              <Card
                className={cn(
                  "cursor-pointer border-dashed border-2 transition-all hover:shadow-md",
                  selectedChapter === "all" &&
                    "border-primary ring-2 ring-primary/20"
                )}
                onClick={() => {
                  setSelectedChapter("all");
                  setStep(3);
                }}
              >
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      <Shuffle className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-bold text-text-primary">{t("allChapters")}</p>
                      <p className="text-xs text-text-secondary">{t("allChaptersDesc")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedSource === "BANK" && textbookTotals && (
                      <Badge variant="info">
                        {textbookTotals.totalQuestions} questions
                      </Badge>
                    )}
                    {selectedSource === "BANK" && <Badge variant="default">{t("recommended")}</Badge>}
                  </div>
                </CardContent>
              </Card>

              {chapters.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <Layers className="mx-auto mb-2 h-10 w-10 text-text-secondary/40" />
                    <p className="text-text-secondary">
                      {t("noChapters")}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                chapters.map((ch) => {
                  const isEmptyBank = selectedSource === "BANK" && ch._count.questions === 0;
                  return (
                    <Card
                      key={ch.id}
                      className={cn(
                        "transition-all",
                        isEmptyBank ? "opacity-60 grayscale cursor-not-allowed" : "cursor-pointer hover:shadow-md",
                        selectedChapter !== "all" && selectedChapter?.id === ch.id &&
                          "border-primary ring-2 ring-primary/20"
                      )}
                      onClick={() => {
                        if (isEmptyBank) return;
                        setSelectedChapter(ch);
                        setStep(3);
                      }}
                    >
                      <CardContent className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                            {ch.chapterNumber}
                          </span>
                          <p className="font-medium text-text-primary">{ch.title}</p>
                        </div>
                        {selectedSource === "BANK" && (
                          <Badge variant="info">
                            {ch._count.questions} questions
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </>
          )}
        </div>
      )}

      {/* Step 4: Select Difficulty */}
      {step === 3 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* AI Adaptive difficulty: need both the user's AI access AND the feature on. */}
          {DIFFICULTY_KEYS.filter((d) => d.value !== "ADAPTIVE" || (ent.ai && ent.aiFeatures.aiAdaptive)).map((d) => {
            const counts = selectedChapter === "all" 
              ? textbookTotals?.difficultyCounts 
              : selectedChapter?.difficultyCounts;
            
            const isAdaptive = d.value === "ADAPTIVE";

            const qCount = isAdaptive 
              ? 0 // Placeholder
              : d.value === "MIXED" 
                ? (selectedChapter === "all" ? textbookTotals?.totalQuestions : selectedChapter?._count.questions)
                : (counts ? counts[d.value as keyof typeof counts] : 0);
            
            const isEmpty = selectedSource === "BANK" && !isAdaptive && qCount === 0;

            return (
            <Card
              key={d.value}
              className={cn(
                "border-2 transition-all",
                isEmpty ? "opacity-60 grayscale cursor-not-allowed" : "cursor-pointer hover:shadow-md",
                selectedDifficulty === d.value
                  ? `${d.borderColor} ring-2 ring-primary/20`
                  : "border-border"
              )}
              onClick={() => {
                if (isEmpty) return;
                setSelectedDifficulty(d.value);
                setStep(4);
              }}
            >
              <CardContent className="py-5 text-center">
                {d.value === "ADAPTIVE" ? (
                  <Sparkles className="mx-auto mb-2 h-8 w-8 text-purple-500 animate-pulse" />
                ) : d.value === "MIXED" ? (
                  <Shuffle className="mx-auto mb-2 h-8 w-8 text-info" />
                ) : (
                  <Zap className="mx-auto mb-2 h-8 w-8 text-primary" />
                )}
                <Badge variant={d.badgeVariant} className={cn("mb-2", isAdaptive && "bg-purple-100 text-purple-700 border-purple-200")}>
                  {t(d.labelKey as any)}
                </Badge>
                <p className="text-sm text-text-secondary">{t(d.descKey as any)}</p>
                {selectedSource === "BANK" && (
                  <p className="mt-2 text-[10px] uppercase font-bold text-primary">
                    {isAdaptive ? t("personalizedLabel") : t("questionsAvailableN", { count: qCount ?? 0 })}
                  </p>
                )}
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {/* Step 5: Question Types */}
      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {selectedSource === "AI"
              ? t("questionsAIFilter")
              : t("questionsBankFilter")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TYPE_KEYS.map((type) => {
              const Icon = type.icon;
              const isSelected = selectedTypes.includes(type.value);
              return (
                <Card
                  key={type.value}
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-md",
                    isSelected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border"
                  )}
                  onClick={() => {
                    if (isSelected) {
                      if (selectedTypes.length > 1) {
                        setSelectedTypes(prev => prev.filter(t => t !== type.value));
                      }
                    } else {
                      setSelectedTypes(prev => [...prev, type.value]);
                    }
                  }}
                >
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className={cn("rounded-lg p-2", isSelected ? "bg-primary text-white" : "bg-gray-100 text-gray-500")}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="font-semibold text-text-primary">{t(type.labelKey as any)}</span>
                    {isSelected && <CheckCircle className="ml-auto h-5 w-5 text-primary" />}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Button className="w-full mt-4" onClick={() => setStep(5)}>
            Continue
          </Button>
        </div>
      )}

      {/* Step 6: Select Question Count */}
      {step === 5 && (() => {
        const typeCounts = selectedChapter === "all"
          ? textbookTotals?.difficultyTypeCounts
          : selectedChapter?.difficultyTypeCounts;

        // Available count that matches what the quiz query will actually return:
        // sum the counts across the chosen difficulty AND the chosen types.
        // (No types selected → all types, matching the backend's type filter.)
        const availableForBank = () => {
          if (!typeCounts) return 0;
          const diffs =
            selectedDifficulty === "EASY" || selectedDifficulty === "MEDIUM" || selectedDifficulty === "HARD"
              ? [selectedDifficulty]
              : ["EASY", "MEDIUM", "HARD"]; // MIXED / ADAPTIVE → all difficulties
          let sum = 0;
          for (const d of diffs) {
            const perType = typeCounts[d] || {};
            const types = selectedTypes.length > 0 ? selectedTypes : Object.keys(perType);
            for (const ty of types) sum += perType[ty] || 0;
          }
          return sum;
        };

        // Define max based on selection
        const maxAvailable = selectedSource === "BANK" ? availableForBank() : 20;

        const isInvalid = !selectedCount || selectedCount < 1 || selectedCount > maxAvailable;

        return (
          <div className="space-y-6">
            <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 text-center">
              <Hash className="mx-auto mb-2 h-8 w-8 text-primary" />
              <p className="mb-2 text-sm font-medium text-text-secondary uppercase tracking-wide">
                How many questions would you like?
              </p>
              
              <div className="flex items-center justify-center gap-4">
                <input
                  type="number"
                  min="1"
                  max={maxAvailable}
                  value={selectedCount || ""}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (isNaN(val)) setSelectedCount(null);
                    else setSelectedCount(val);
                  }}
                  className="w-32 rounded-xl border-2 border-primary bg-white py-3 text-center text-4xl font-bold text-text-primary focus:outline-none focus:ring-4 focus:ring-primary/20"
                  placeholder="0"
                />
              </div>
              
              <div className="mt-4 flex justify-center gap-2 flex-wrap">
                {buildQuickPresets(maxAvailable).map(n => (
                  <button
                    key={n}
                    onClick={() => setSelectedCount(n)}
                    className={cn(
                      "px-4 py-2 rounded-lg border-2 text-sm font-bold transition-all",
                      selectedCount === n 
                        ? "bg-primary text-white border-primary" 
                        : "bg-white text-primary border-primary/20 hover:border-primary"
                    )}
                  >
                    {n}
                  </button>
                ))}
                {maxAvailable > 0 && (
                  <button
                    onClick={() => setSelectedCount(maxAvailable)}
                    className={cn(
                      "px-4 py-2 rounded-lg border-2 text-sm font-bold transition-all",
                      selectedCount === maxAvailable 
                        ? "bg-primary text-white border-primary" 
                        : "bg-white text-primary border-primary/20 hover:border-primary"
                    )}
                  >
                    Max ({maxAvailable})
                  </button>
                )}
              </div>
              
              <p className={cn(
                "mt-4 text-xs font-semibold",
                isInvalid && selectedCount ? "text-error" : "text-text-secondary"
              )}>
                {selectedSource === "BANK" 
                  ? `Available questions in this selection: ${maxAvailable}`
                  : `AI can generate up to 20 questions per session.`}
              </p>
            </div>

            <Button 
              className="w-full" 
              size="lg"
              disabled={isInvalid}
              onClick={() => setStep(6)}
            >
              Continue
            </Button>
          </div>
        );
      })()}

      {/* Step 7: Select Mode */}
      {step === 6 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* SOLO card */}
          <div
            className={cn(
              "cursor-pointer rounded-xl border-2 p-6 text-center transition-all hover:shadow-md",
              selectedMode === "SOLO"
                ? "border-primary ring-2 ring-primary/20"
                : "border-border"
            )}
            onClick={() => {
              setSelectedMode("SOLO");
              setStep(7);
            }}
          >
            <Clock className="mx-auto mb-2 h-8 w-8 text-primary" />
            <p className="font-bold text-text-primary">{t("soloMode")}</p>
            <p className="text-sm text-text-secondary">{t("soloDesc")}</p>
            <p className="mt-2 text-xs text-text-secondary">
              {t("soloPace")}
            </p>
          </div>

          {/* TIMED card */}
          <div
            className={cn(
              "cursor-pointer rounded-xl border-2 p-6 text-center transition-all hover:shadow-md",
              selectedMode === "TIMED"
                ? "border-warning ring-2 ring-warning/20"
                : "border-border"
            )}
            onClick={() => {
              setSelectedMode("TIMED");
              setStep(7);
            }}
          >
            <Timer className="mx-auto mb-2 h-8 w-8 text-warning" />
            <p className="font-bold text-text-primary">{t("timedMode")}</p>
            <p className="text-sm text-text-secondary">{t("timedDesc")}</p>
            <p className="mt-2 text-xs text-text-secondary">
              {t("timedBonus")}
            </p>
          </div>
        </div>
      )}

      {/* Step 8: Review & Start */}
      {step === 7 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 py-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">{t("subjectLabel")}</span>
                <span className="font-medium text-text-primary">
                  {selectedTextbook?.subject}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">{t("chapterLabel")}</span>
                <span className="font-medium text-text-primary text-right">
                  {selectedChapter === "all" ? (
                    t("allChaptersCumulative")
                  ) : (
                    `Ch. ${selectedChapter?.chapterNumber} – ${selectedChapter?.title}`
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">{t("sourceLabel")}</span>
                <Badge variant={selectedSource === "AI" ? "info" : "default"}>
                  {selectedSource === "AI" ? t("aiGeneratedLabel") : t("questionBankSource")}
                </Badge>
              </div>
              <div className="flex flex-col gap-2 border-b border-border pb-3">
                <span className="text-sm text-text-secondary">{t("questionTypesLabel")}</span>
                <div className="flex flex-wrap gap-1">
                  {selectedTypes.map(typeVal => (
                    <Badge key={typeVal} variant="default" className="text-[10px]">
                      {(() => { const k = TYPE_KEYS.find(opt => opt.value === typeVal)?.labelKey; return k ? t(k as any) : typeVal; })()}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">{t("difficultyLabel")}</span>
                <Badge
                  variant={
                    DIFFICULTY_KEYS.find((d) => d.value === selectedDifficulty)
                      ?.badgeVariant || "default"
                  }
                >
                  {(() => { const k = DIFFICULTY_KEYS.find(d => d.value === selectedDifficulty)?.labelKey; return k ? t(k as any) : selectedDifficulty; })()}
                </Badge>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">{t("questionsLabel")}</span>
                <span className="font-medium text-text-primary">
                  {selectedCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{t("modeLabel")}</span>
                <Badge variant={selectedMode === "TIMED" ? "warning" : "info"}>
                  {selectedMode === "TIMED" ? (
                    <span className="flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {t("timedMode")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t("soloMode")}
                    </span>
                  )}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Adaptive Insights Banner — shown after AI calibration */}
          {selectedDifficulty === "ADAPTIVE" && !adaptiveInsights && (
            <div className="flex items-start gap-3 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-purple-500 animate-pulse" />
              <div>
                <p className="text-sm font-semibold text-purple-800">{t("aiAdaptiveBanner")}</p>
                <p className="mt-0.5 text-xs text-purple-600">
                  {t("aiAdaptiveBannerDesc")}
                </p>
              </div>
            </div>
          )}
          {adaptiveInsights && (
            <div className="flex items-start gap-3 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
              {adaptiveInsights.trend === "improving" ? (
                <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
              ) : adaptiveInsights.trend === "declining" ? (
                <TrendingDown className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
              ) : (
                <Minus className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
              )}
              <div>
                <p className="text-sm font-semibold text-purple-800">
                  {t("aiCalibratedLabel")}{" "}
                  <span className={cn(
                    "font-bold",
                    adaptiveInsights.difficulty === "HARD" ? "text-red-600" :
                    adaptiveInsights.difficulty === "EASY" ? "text-green-600" : "text-yellow-700"
                  )}>
                    {adaptiveInsights.difficulty}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-purple-700">{adaptiveInsights.reasoning}</p>
                {adaptiveInsights.quizzesAnalyzed > 0 && (
                  <p className="mt-1 text-[10px] text-purple-500">
                    Based on {adaptiveInsights.quizzesAnalyzed} quiz{adaptiveInsights.quizzesAnalyzed !== 1 ? "zes" : ""} &bull; {adaptiveInsights.weightedAccuracy}% weighted accuracy
                  </p>
                )}
              </div>
            </div>
          )}

          <Button
            size="lg"
            className="w-full gap-2 text-base shadow-lg shadow-primary/20"
            onClick={handleStartQuiz}
            isLoading={generating}
          >
            {selectedSource === "AI" ? (
              <Sparkles className="h-5 w-5" />
            ) : (
              <CheckCircle className="h-5 w-5" />
            )}
            {selectedSource === "AI" ? t("generateStart") : t("startQuiz")}
          </Button>
        </div>
      )}
    </div>
  );
}
