"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { 
  BookOpen, 
  TrendingUp, 
  Target, 
  AlertCircle,
  Brain,
  ChevronRight
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, scoreVariant } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type MasteryLevel = "NOT_STARTED" | "IN_PROGRESS" | "PROFICIENT" | "MASTERED";

interface SubjectStat {
  subject: string;
  grade: number;
  avgScore: number;
  quizCount: number;
  chapterCount: number;
  trend: { date: string; score: number }[];
}

interface ChapterStat {
  id: string;
  title: string;
  subject: string;
  grade: number;
  masteryLevel: MasteryLevel;
  avgScore: number;
  attemptCount: number;
}

interface ProgressData {
  subjects: SubjectStat[];
  chapters: ChapterStat[];
  weakestChapters: ChapterStat[];
  studyRecommendations: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const masteryConfig: Record<
  MasteryLevel,
  { label: string; color: string; bg: string; text: string }
> = {
  NOT_STARTED: { label: "Not Started", color: "#94a3b8", bg: "bg-slate-100", text: "text-slate-500" },
  IN_PROGRESS: { label: "In Progress", color: "#3b82f6", bg: "bg-blue-100", text: "text-blue-600" },
  PROFICIENT: { label: "Proficient", color: "#eab308", bg: "bg-yellow-100", text: "text-yellow-700" },
  MASTERED: { label: "Mastered", color: "#22c55e", bg: "bg-green-100", text: "text-green-700" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StudentProgressPage() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProgress() {
      try {
        const res = await fetch("/api/students/me/progress");
        if (!res.ok) throw new Error("Failed to load progress data");
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchProgress();
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-error" />
        <p className="text-text-secondary">{error || "No data available"}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  const { subjects, chapters, weakestChapters, studyRecommendations } = data;

  return (
    <div className="mx-auto max-w-6xl space-y-10 p-4 sm:p-8">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-text-primary">My Performance</h1>
          <p className="text-text-secondary">Level up your chapter mastery and track your progress.</p>
        </div>
        <Badge variant="info" className="w-fit h-fit px-3 py-1 text-sm font-bold">
          {chapters.filter((c: ChapterStat) => c.masteryLevel === "MASTERED").length} / {chapters.length} Mastered
        </Badge>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        
        {/* Left Column: Subjects & Trends */}
        <div className="lg:col-span-2 space-y-8">
          
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-text-primary">
              <TrendingUp className="h-5 w-5 text-primary" />
              Subject Performance
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {subjects.map((sub: SubjectStat) => (
                <Card key={`${sub.subject}-${sub.grade}`} className="group overflow-hidden border-border/50 hover:border-primary/30 transition-all">
                  <CardContent className="p-0">
                    <div className="p-5 pb-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-text-muted uppercase tracking-wider">{sub.subject}</span>
                        <span className="text-2xl font-black text-text-primary">{sub.avgScore}%</span>
                      </div>
                      <ProgressBar 
                        value={sub.avgScore} 
                        size="sm" 
                        color={sub.avgScore >= 70 ? "success" : sub.avgScore >= 40 ? "primary" : "secondary"}
                        className="mt-2"
                      />
                    </div>
                    {/* Trend Sparkline */}
                    <div className="h-24 w-full mt-4 bg-primary/5">
                      {sub.trend && sub.trend.length > 1 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={sub.trend}>
                            <Line 
                              type="monotone" 
                              dataKey="score" 
                              stroke="var(--color-primary)" 
                              strokeWidth={3} 
                              dot={false}
                              animationDuration={1000}
                            />
                            <Tooltip 
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="rounded-lg border border-border bg-surface p-2 shadow-xl ring-1 ring-black/5">
                                      <p className="text-[10px] font-bold text-text-muted uppercase">{payload[0].payload.date}</p>
                                      <p className="text-sm font-black text-text-primary">{payload[0].value}%</p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-text-muted italic">
                          Need more quizzes for trend...
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Mastery Map Grid */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-text-primary">
              <Target className="h-5 w-5 text-primary" />
              Chapter Mastery Map
            </h2>
            <Card className="p-6">
              <div className="mb-6 grid grid-cols-2 gap-4 sm:flex sm:items-center">
                {(Object.entries(masteryConfig) as [MasteryLevel, typeof masteryConfig['MASTERED']][]).map(([key, config]) => (
                  <div key={key} className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: config.color }} />
                    <span className="text-xs font-semibold text-text-secondary">{config.label}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {chapters.map((chapter: ChapterStat) => (
                  <div 
                    key={chapter.id}
                    title={`${chapter.title} - ${chapter.avgScore}%`}
                    className={cn(
                      "group relative flex aspect-square flex-col items-center justify-center rounded-2xl border-2 transition-all hover:scale-105 hover:shadow-lg active:scale-95 cursor-default",
                      masteryConfig[chapter.masteryLevel as MasteryLevel].bg,
                      "border-transparent"
                    )}
                  >
                    <BookOpen className={cn("mb-1 h-6 w-6", masteryConfig[chapter.masteryLevel as MasteryLevel].text)} />
                    <span className={cn("px-2 text-center text-[10px] font-black uppercase leading-tight line-clamp-2", masteryConfig[chapter.masteryLevel as MasteryLevel].text)}>
                      {chapter.title}
                    </span>
                    {chapter.attemptCount > 0 && (
                      <span className="absolute bottom-1 right-2 text-[10px] font-bold opacity-40">
                        {chapter.avgScore}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </div>

        {/* Right Column: AI Recommendations & Weakest Areas */}
        <div className="space-y-8">
          
          {/* AI Recommendations */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-text-primary">
              <Brain className="h-5 w-5 text-purple-500" />
              AI Recommendations
            </h2>
            <div className="space-y-4">
              {studyRecommendations.length > 0 ? (
                studyRecommendations.map((rec: string, idx: number) => (
                  <Card key={idx} className="relative overflow-hidden border-purple-200 bg-purple-50/50 hover:bg-purple-50 transition-colors">
                    <CardContent className="p-4">
                       <p className="text-xs font-bold text-purple-600 uppercase tracking-tighter mb-1">Personal Goal</p>
                       <p className="text-sm font-medium text-purple-900 leading-relaxed">{rec}</p>
                       <div className="mt-3 flex items-center gap-1 text-[10px] font-bold text-purple-600 uppercase">
                         Explore Chapter <ChevronRight className="h-3 w-3" />
                       </div>
                    </CardContent>
                    <div className="absolute top-0 right-0 h-16 w-16 -translate-y-8 translate-x-8 rounded-full bg-purple-200/30" />
                  </Card>
                ))
              ) : (
                <Card className="border-dashed py-8 text-center bg-gray-50/50">
                  <p className="text-sm text-text-secondary font-medium">No recommendations yet. Great job!</p>
                </Card>
              )}
            </div>
          </section>

          {/* Weakest Topics List */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-text-primary">
              <AlertCircle className="h-5 w-5 text-error" />
              Critical Gaps
            </h2>
            <Card className="overflow-hidden border-red-100">
              <div className="divide-y divide-red-50">
                {weakestChapters.length > 0 ? (
                  weakestChapters.map((cap: ChapterStat) => (
                    <div key={cap.id} className="group flex items-center justify-between p-4 bg-red-50/20 hover:bg-red-50/40 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-text-primary truncate">{cap.title}</p>
                        <p className="text-[10px] text-text-muted truncate uppercase">{cap.subject} &middot; Grade {cap.grade}</p>
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <p className="text-lg font-black text-error">{cap.avgScore}%</p>
                        <p className="text-[9px] font-bold text-red-400 uppercase tracking-tighter">Action Needed</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-text-secondary font-medium">
                    No critical gaps identified. Keep it up!
                  </div>
                )}
              </div>
            </Card>
          </section>

        </div>
      </div>
    </div>
  );
}
