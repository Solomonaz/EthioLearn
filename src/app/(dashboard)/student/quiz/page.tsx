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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useQuizStore } from "@/stores/quiz-store";
import { cn } from "@/lib/utils";

interface Textbook {
  id: string;
  title: string;
  subject: string;
  grade: number;
  _count: { chapters: number };
}

interface Chapter {
  id: string;
  title: string;
  chapterNumber: number;
  _count: { questions: number };
}

type Difficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED";
type QuizMode = "SOLO" | "TIMED";

const STEPS = ["Subject", "Chapter", "Difficulty", "Questions", "Mode", "Review"];
const QUESTION_COUNTS = [5, 10, 15, 20];

const DIFFICULTY_CONFIG: {
  value: Difficulty;
  label: string;
  description: string;
  badgeVariant: "difficulty-easy" | "difficulty-medium" | "difficulty-hard" | "info";
  borderColor: string;
}[] = [
  {
    value: "EASY",
    label: "Easy",
    description: "Foundational questions to build confidence",
    badgeVariant: "difficulty-easy",
    borderColor: "border-green-400",
  },
  {
    value: "MEDIUM",
    label: "Medium",
    description: "Balanced questions for steady progress",
    badgeVariant: "difficulty-medium",
    borderColor: "border-yellow-400",
  },
  {
    value: "HARD",
    label: "Hard",
    description: "Challenging questions to push your limits",
    badgeVariant: "difficulty-hard",
    borderColor: "border-red-400",
  },
  {
    value: "MIXED",
    label: "Mixed",
    description: "A mix of all difficulty levels",
    badgeVariant: "info",
    borderColor: "border-blue-400",
  },
];

export default function QuizLauncherPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const startQuiz = useQuizStore((s) => s.startQuiz);

  const [step, setStep] = useState(0);
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loadingTextbooks, setLoadingTextbooks] = useState(true);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selections
  const [selectedTextbook, setSelectedTextbook] = useState<Textbook | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [selectedCount, setSelectedCount] = useState<number | null>(null);
  const [selectedMode, setSelectedMode] = useState<QuizMode>("SOLO");

  // Fetch textbooks on mount
  useEffect(() => {
    async function fetchTextbooks() {
      try {
        const grade = session?.user?.grade;
        const url = grade
          ? `/api/textbooks?grade=${grade}`
          : "/api/textbooks";
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load subjects");
        const data = await res.json();
        setTextbooks(data.textbooks);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load subjects");
      } finally {
        setLoadingTextbooks(false);
      }
    }
    if (session) fetchTextbooks();
  }, [session]);

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
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to generate quiz");
        }
        const data = await res.json();
        startQuiz(data.quizId, data.questions, "SOLO");
        // Award daily challenge points
        fetch("/api/students/me/daily-challenge", { method: "POST" }).catch(() => {});
        router.push(`/student/quiz/${data.quizId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start challenge");
        setGenerating(false);
      }
    }
    launchChallenge();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStartQuiz() {
    if (!selectedChapter || !selectedDifficulty || !selectedCount) return;

    setGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/quizzes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: selectedChapter.id,
          difficulty: selectedDifficulty,
          questionCount: selectedCount,
          mode: selectedMode,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate quiz");
      }

      const data = await res.json();
      startQuiz(data.quizId, data.questions, data.mode ?? selectedMode);
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
            Back
          </button>
          <p className="text-sm text-text-secondary">
            Step {step + 1} of {STEPS.length}
          </p>
        </div>
        <h1 className="mt-2 text-xl font-bold text-text-primary">
          {step === 0 && "Select a Subject"}
          {step === 1 && "Select a Chapter"}
          {step === 2 && "Choose Difficulty"}
          {step === 3 && "How Many Questions?"}
          {step === 4 && "Choose Mode"}
          {step === 5 && "Review & Start"}
        </h1>

        {/* Progress dots */}
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
          {loadingTextbooks ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" className="text-primary" />
            </div>
          ) : textbooks.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <BookOpen className="mx-auto mb-2 h-10 w-10 text-text-secondary/40" />
                <p className="text-text-secondary">
                  No subjects available for your grade.
                </p>
              </CardContent>
            </Card>
          ) : (
            textbooks.map((tb) => (
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
                  <Badge>{tb._count.chapters} chapters</Badge>
                  <ChevronRight className="h-5 w-5 text-text-secondary" />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Step 2: Select Chapter */}
      {step === 1 && (
        <div className="space-y-2">
          {loadingChapters ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" className="text-primary" />
            </div>
          ) : chapters.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Layers className="mx-auto mb-2 h-10 w-10 text-text-secondary/40" />
                <p className="text-text-secondary">
                  No chapters available for this textbook.
                </p>
              </CardContent>
            </Card>
          ) : (
            chapters.map((ch) => (
              <Card
                key={ch.id}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  selectedChapter?.id === ch.id &&
                    "border-primary ring-2 ring-primary/20"
                )}
                onClick={() => {
                  setSelectedChapter(ch);
                  setStep(2);
                }}
              >
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {ch.chapterNumber}
                    </span>
                    <p className="font-medium text-text-primary">{ch.title}</p>
                  </div>
                  <Badge variant="info">
                    {ch._count.questions} questions
                  </Badge>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Step 3: Select Difficulty */}
      {step === 2 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {DIFFICULTY_CONFIG.map((d) => (
            <Card
              key={d.value}
              className={cn(
                "cursor-pointer border-2 transition-all hover:shadow-md",
                selectedDifficulty === d.value
                  ? `${d.borderColor} ring-2 ring-primary/20`
                  : "border-border"
              )}
              onClick={() => {
                setSelectedDifficulty(d.value);
                setStep(3);
              }}
            >
              <CardContent className="py-5 text-center">
                {d.value === "MIXED" ? (
                  <Shuffle className="mx-auto mb-2 h-8 w-8 text-info" />
                ) : (
                  <Zap className="mx-auto mb-2 h-8 w-8 text-primary" />
                )}
                <Badge variant={d.badgeVariant} className="mb-2">
                  {d.label}
                </Badge>
                <p className="text-sm text-text-secondary">{d.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Step 4: Select Question Count */}
      {step === 3 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUESTION_COUNTS.map((count) => (
            <Card
              key={count}
              className={cn(
                "cursor-pointer border-2 transition-all hover:shadow-md",
                selectedCount === count
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border"
              )}
              onClick={() => {
                setSelectedCount(count);
                setStep(4);
              }}
            >
              <CardContent className="py-6 text-center">
                <Hash className="mx-auto mb-2 h-6 w-6 text-primary" />
                <p className="text-2xl font-bold text-text-primary">{count}</p>
                <p className="text-sm text-text-secondary">questions</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Step 5: Select Mode */}
      {step === 4 && (
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
              setStep(5);
            }}
          >
            <Clock className="mx-auto mb-2 h-8 w-8 text-primary" />
            <p className="font-bold text-text-primary">Solo Mode</p>
            <p className="text-sm text-text-secondary">No time limit</p>
            <p className="mt-2 text-xs text-text-secondary">
              Answer at your own pace
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
              setStep(5);
            }}
          >
            <Timer className="mx-auto mb-2 h-8 w-8 text-warning" />
            <p className="font-bold text-text-primary">Timed Mode</p>
            <p className="text-sm text-text-secondary">30s per question</p>
            <p className="mt-2 text-xs text-text-secondary">
              +10% bonus points for speed
            </p>
          </div>
        </div>
      )}

      {/* Step 6: Review & Start */}
      {step === 5 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 py-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">Subject</span>
                <span className="font-medium text-text-primary">
                  {selectedTextbook?.subject}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">Chapter</span>
                <span className="font-medium text-text-primary">
                  Ch. {selectedChapter?.chapterNumber} &ndash;{" "}
                  {selectedChapter?.title}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">Difficulty</span>
                <Badge
                  variant={
                    DIFFICULTY_CONFIG.find((d) => d.value === selectedDifficulty)
                      ?.badgeVariant || "default"
                  }
                >
                  {selectedDifficulty}
                </Badge>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">Questions</span>
                <span className="font-medium text-text-primary">
                  {selectedCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Mode</span>
                <Badge variant={selectedMode === "TIMED" ? "warning" : "info"}>
                  {selectedMode === "TIMED" ? (
                    <span className="flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      Timed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Solo
                    </span>
                  )}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Button
            size="lg"
            className="w-full gap-2 text-base"
            onClick={handleStartQuiz}
            isLoading={generating}
          >
            <CheckCircle className="h-5 w-5" />
            Start Quiz
          </Button>
        </div>
      )}
    </div>
  );
}
