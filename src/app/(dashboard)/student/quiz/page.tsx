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
  difficultyCounts: { EASY: number; MEDIUM: number; HARD: number };
}

type Difficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED" | "ADAPTIVE";
type QuizMode = "SOLO" | "TIMED";

const STEPS = ["Subject", "Source", "Chapter", "Difficulty", "Types", "Questions", "Mode", "Review"];
const TYPE_OPTIONS = [
  { value: "MCQ", label: "Multiple Choice", icon: Layers },
  { value: "TRUE_FALSE", label: "True / False", icon: CheckCircle },
  { value: "FILL_IN_BLANK", label: "Fill in the Blank", icon: Sparkles },
  { value: "MATCH_PAIRS", label: "Match Pairs", icon: Shuffle },
  { value: "ORDERING", label: "Ordering", icon: Layers },
];
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
    value: "ADAPTIVE",
    label: "AI Adaptive",
    description: "AI calibrates the perfect level for you based on history",
    badgeVariant: "info",
    borderColor: "border-purple-400",
  },
  {
    value: "MIXED",
    label: "Mixed",
    description: "A mix of all difficulty levels",
    badgeVariant: "info",
    borderColor: "border-blue-400",
  },
];

const SOURCE_CONFIG = [
  {
    value: "BANK" as const,
    label: "Question Bank",
    description: "Practice with verified questions from the school curriculum",
    icon: Layers,
  },
  {
    value: "AI" as const,
    label: "AI Generation",
    description: "Generate fresh, unique questions using artificial intelligence",
    icon: Sparkles,
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
  const [textbookTotals, setTextbookTotals] = useState<{
    totalQuestions: number;
    difficultyCounts: { EASY: number; MEDIUM: number; HARD: number };
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selections
  const [selectedTextbook, setSelectedTextbook] = useState<Textbook | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | "all" | null>(null);
  const [selectedSource, setSelectedSource] = useState<"BANK" | "AI">("BANK");
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["MCQ"]);
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
          {step === 1 && "Question Source"}
          {step === 2 && "Select a Chapter"}
          {step === 3 && "Choose Difficulty"}
          {step === 4 && "Question Types"}
          {step === 5 && "How Many Questions?"}
          {step === 6 && "Choose Mode"}
          {step === 7 && "Review & Start"}
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

      {/* Step 2: Select Source */}
      {step === 1 && (
        <div className="grid gap-4">
          {SOURCE_CONFIG.map((src) => {
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
                      <p className="font-bold text-text-primary">{src.label}</p>
                      {src.value === "AI" && (
                        <Badge className="bg-primary/10 text-primary border-none text-[10px] uppercase">New</Badge>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary">
                      {src.description}
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
                      <p className="font-bold text-text-primary">All Chapters</p>
                      <p className="text-xs text-text-secondary">Comprehensive practice across the entire book</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedSource === "BANK" && textbookTotals && (
                      <Badge variant="info">
                        {textbookTotals.totalQuestions} questions
                      </Badge>
                    )}
                    {selectedSource === "BANK" && <Badge variant="default">Recommended</Badge>}
                  </div>
                </CardContent>
              </Card>

              {chapters.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <Layers className="mx-auto mb-2 h-10 w-10 text-text-secondary/40" />
                    <p className="text-text-secondary">
                      No chapters available for this textbook.
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
          {DIFFICULTY_CONFIG.map((d) => {
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
                  {d.label}
                </Badge>
                <p className="text-sm text-text-secondary">{d.description}</p>
                {selectedSource === "BANK" && (
                  <p className="mt-2 text-[10px] uppercase font-bold text-primary">
                    {isAdaptive ? "Personalized selection" : `${qCount} Questions available`}
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
              ? "What types of questions would you like the AI to generate?" 
              : "Filter questions from the bank by type:"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TYPE_OPTIONS.map((type) => {
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
                    <span className="font-semibold text-text-primary">{type.label}</span>
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
        const counts = selectedChapter === "all" 
          ? textbookTotals?.difficultyCounts 
          : selectedChapter?.difficultyCounts;
        
        // Define max based on selection
        let maxAvailable = 20; // Default for AI
        if (selectedSource === "BANK") {
          if (selectedDifficulty === "MIXED") {
            maxAvailable = selectedChapter === "all" ? (textbookTotals?.totalQuestions || 0) : (selectedChapter?._count.questions || 0);
          } else if (counts) {
            maxAvailable = counts[selectedDifficulty as keyof typeof counts] || 0;
          }
        }

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
                {[5, 10, 20].filter(n => n <= maxAvailable).map(n => (
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
              setStep(7);
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

      {/* Step 8: Review & Start */}
      {step === 7 && (
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
                <span className="font-medium text-text-primary text-right">
                  {selectedChapter === "all" ? (
                    "All Chapters (Cumulative)"
                  ) : (
                    `Ch. ${selectedChapter?.chapterNumber} – ${selectedChapter?.title}`
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm text-text-secondary">Source</span>
                <Badge variant={selectedSource === "AI" ? "info" : "default"}>
                  {selectedSource === "AI" ? "AI Generated" : "Question Bank"}
                </Badge>
              </div>
              <div className="flex flex-col gap-2 border-b border-border pb-3">
                <span className="text-sm text-text-secondary">Question Types</span>
                <div className="flex flex-wrap gap-1">
                  {selectedTypes.map(t => (
                    <Badge key={t} variant="default" className="text-[10px]">
                      {TYPE_OPTIONS.find(opt => opt.value === t)?.label}
                    </Badge>
                  ))}
                </div>
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
            className="w-full gap-2 text-base shadow-lg shadow-primary/20"
            onClick={handleStartQuiz}
            isLoading={generating}
          >
            {selectedSource === "AI" ? (
              <Sparkles className="h-5 w-5" />
            ) : (
              <CheckCircle className="h-5 w-5" />
            )}
            {selectedSource === "AI" ? "Generate & Start Practice" : "Start Quiz"}
          </Button>
        </div>
      )}
    </div>
  );
}
