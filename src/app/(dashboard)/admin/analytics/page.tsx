"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import {
  BarChart2,
  BookOpen,
  Star,
  Users,
  UserPlus,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Download,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "7d" | "30d" | "90d";

interface ActivityDay {
  date: string;
  quizzes: number;
  avgScore: number;
}

interface SubjectStat {
  subject: string;
  quizzes: number;
  avgScore: number;
  totalPoints: number;
}

interface DifficultyStat {
  difficulty: string;
  count: number;
  correct: number;
  accuracy: number;
}

interface ScoreBucket {
  range: string;
  count: number;
}

interface GradeStat {
  grade: number;
  avgPoints: number;
  studentCount: number;
}

interface Summary {
  totalQuizzes: number;
  avgScore: number;
  totalPointsAwarded: number;
  activeStudents: number;
  newStudents: number;
  completionRate: number;
}

interface SubjectDifficultyCell {
  subject: string;
  easy: number;
  medium: number;
  hard: number;
}

interface AnalyticsData {
  period: string;
  summary: Summary;
  activityByDay: ActivityDay[];
  subjectStats: SubjectStat[];
  difficultyStats: DifficultyStat[];
  scoreDistribution: ScoreBucket[];
  gradeStats: GradeStat[];
  subjectDifficultyMatrix: SubjectDifficultyCell[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = "#1B5E20";
const PRIMARY_LIGHT = "#43A047";
const PRIMARY_PALE = "#C8E6C9";

const SUBJECT_COLORS = [
  "#1B5E20",
  "#2E7D32",
  "#388E3C",
  "#43A047",
  "#4CAF50",
  "#66BB6A",
  "#81C784",
  "#A5D6A7",
];

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-lg bg-gray-100 ${className}`} />
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-8 w-40" />
        <SkeletonBlock className="h-10 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <SkeletonBlock className="mb-2 h-4 w-20" />
              <SkeletonBlock className="h-8 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <SkeletonBlock className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <SkeletonBlock className="h-64 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  badge?: string;
  badgeVariant?: "success" | "info" | "warning" | "error";
}

function SummaryCard({ label, value, icon: Icon, badge, badgeVariant = "info" }: SummaryCardProps) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          </div>
          <div className="rounded-lg bg-green-50 p-2">
            <Icon className="h-5 w-5 text-[#1B5E20]" />
          </div>
        </div>
        {badge && (
          <div className="mt-2">
            <Badge variant={badgeVariant} className="text-xs">
              {badge}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md text-sm">
      <p className="mb-1 font-medium text-gray-700">{label}</p>
      {payload.map((item, i) => (
        <p key={i} style={{ color: item.color }}>
          {item.name}: <span className="font-semibold">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Difficulty Card ──────────────────────────────────────────────────────────

function DifficultyCard({ stat, accuracyLabel }: { stat: DifficultyStat; accuracyLabel: string }) {
  const colorMap: Record<string, { bg: string; text: string; badge: string }> = {
    Easy: { bg: "bg-green-50", text: "text-green-700", badge: "bg-green-100 text-green-700" },
    Medium: { bg: "bg-yellow-50", text: "text-yellow-700", badge: "bg-yellow-100 text-yellow-700" },
    Hard: { bg: "bg-red-50", text: "text-red-700", badge: "bg-red-100 text-red-700" },
  };
  const colors = colorMap[stat.difficulty] ?? colorMap.Medium;

  return (
    <div className={`rounded-xl p-4 ${colors.bg}`}>
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${colors.text}`}>{stat.difficulty}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${colors.badge}`}>
          {accuracyLabel}
        </span>
      </div>
      <p className={`mt-1 text-2xl font-bold ${colors.text}`}>
        {stat.count.toLocaleString()}
      </p>
      <p className="text-xs text-gray-500">
        {stat.correct} / {stat.count}
      </p>
    </div>
  );
}

// ─── Subject × Difficulty Heatmap ────────────────────────────────────────────

function cellColor(value: number): string {
  if (value < 0) return "bg-gray-50 text-gray-400";
  if (value >= 70) return "bg-green-100 text-green-800";
  if (value >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-700";
}

function SubjectDifficultyHeatmap({
  data,
  title,
  desc,
  legendLabel,
  legendGood,
  legendFair,
  legendNeedsWork,
  legendNoData,
  colSubject,
}: {
  data: SubjectDifficultyCell[];
  title: string;
  desc: string;
  legendLabel: string;
  legendGood: string;
  legendFair: string;
  legendNeedsWork: string;
  legendNoData: string;
  colSubject: string;
}) {
  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-[#1B5E20]" />
          <h2 className="font-semibold text-gray-900">{title}</h2>
        </div>
        <p className="text-xs text-gray-500 mt-1">{desc}</p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">{colSubject}</th>
                <th className="px-4 py-3 text-center font-medium text-green-700">Easy</th>
                <th className="px-4 py-3 text-center font-medium text-yellow-700">Medium</th>
                <th className="px-4 py-3 text-center font-medium text-red-700">Hard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.map((row) => (
                <tr key={row.subject} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-800">{row.subject}</td>
                  {([row.easy, row.medium, row.hard] as const).map((val, i) => (
                    <td key={i} className="px-4 py-3 text-center">
                      <span className={`inline-block min-w-[52px] rounded-full px-2 py-1 text-xs font-bold ${cellColor(val)}`}>
                        {val < 0 ? "—" : `${val}%`}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3">
          <span className="text-xs text-gray-500">{legendLabel}</span>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{legendGood}</span>
          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">{legendFair}</span>
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{legendNeedsWork}</span>
          <span className="rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-400">{legendNoData}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const t = useTranslations("admin");
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const PERIOD_LABELS: Record<Period, string> = {
    "7d": t("period7d"),
    "30d": t("period30d"),
    "90d": t("period90d"),
  };

  const fetchAnalytics = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics?period=${p}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load analytics");
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics(period);
  }, [period, fetchAnalytics]);

  if (loading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-gray-600">{error ?? t("failedLoad")}</p>
        <Button variant="outline" onClick={() => fetchAnalytics(period)}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  }

  const { summary, activityByDay, subjectStats, difficultyStats, scoreDistribution, gradeStats, subjectDifficultyMatrix } = data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("analyticsTitle")}</h1>
          <p className="text-sm text-gray-500">{t("analyticsSubtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period selector */}
          <div className="flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                  period === p
                    ? "bg-[#1B5E20] text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Export CSV */}
          <a
            href={`/api/admin/analytics/export?period=${period}`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            {t("exportCsv")}
          </a>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <SummaryCard
          label={t("totalQuizzesCard")}
          value={summary.totalQuizzes.toLocaleString()}
          icon={BookOpen}
          badge={t("completionRate", { rate: summary.completionRate })}
          badgeVariant="success"
        />
        <SummaryCard
          label={t("averageScore")}
          value={`${summary.avgScore}%`}
          icon={Star}
          badge={
            summary.avgScore >= 70
              ? t("aboveTarget")
              : summary.avgScore >= 50
              ? t("nearTarget")
              : t("belowTarget")
          }
          badgeVariant={
            summary.avgScore >= 70 ? "success" : summary.avgScore >= 50 ? "warning" : "error"
          }
        />
        <SummaryCard
          label={t("pointsAwarded")}
          value={summary.totalPointsAwarded.toLocaleString()}
          icon={TrendingUp}
        />
        <SummaryCard
          label={t("activeStudents")}
          value={summary.activeStudents.toLocaleString()}
          icon={Users}
        />
        <SummaryCard
          label={t("newStudents")}
          value={summary.newStudents.toLocaleString()}
          icon={UserPlus}
        />
      </div>

      {/* ── Charts Row 1 ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-[#1B5E20]" />
              <h2 className="font-semibold text-gray-900">{t("quizActivityChart")}</h2>
            </div>
          </CardHeader>
          <CardContent>
            {activityByDay.every((d) => d.quizzes === 0) ? (
              <div className="flex h-64 items-center justify-center text-sm text-gray-400">
                {t("noActivityPeriod")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={activityByDay} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={35} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Line yAxisId="left" type="monotone" dataKey="quizzes" stroke={PRIMARY} strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Quizzes" />
                  <Line yAxisId="right" type="monotone" dataKey="avgScore" stroke={PRIMARY_LIGHT} strokeWidth={2} strokeDasharray="4 2" dot={false} activeDot={{ r: 4 }} name="Avg Score (%)" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row 2 ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Subject Performance */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-[#1B5E20]" />
              <h2 className="font-semibold text-gray-900">{t("subjectPerformance")}</h2>
            </div>
          </CardHeader>
          <CardContent>
            {subjectStats.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-gray-400">
                {t("noSubjectData")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, subjectStats.length * 48)}>
                <BarChart data={subjectStats} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="subject" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={80} />
                  <Tooltip formatter={(value) => [`${value}%`, t("colAvgScore")]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
                  <Bar dataKey="avgScore" name={t("colAvgScore")} radius={[0, 4, 4, 0]}>
                    {subjectStats.map((_, index) => (
                      <Cell key={index} fill={SUBJECT_COLORS[index % SUBJECT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Score Distribution */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-[#1B5E20]" />
              <h2 className="font-semibold text-gray-900">{t("scoreDistribution")}</h2>
            </div>
          </CardHeader>
          <CardContent>
            {scoreDistribution.every((b) => b.count === 0) ? (
              <div className="flex h-64 items-center justify-center text-sm text-gray-400">
                {t("noScoreData")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={scoreDistribution} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={30} />
                  <Tooltip formatter={(value) => [value, t("colStudents")]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
                  <Bar dataKey="count" name={t("colStudents")} radius={[4, 4, 0, 0]}>
                    {scoreDistribution.map((_, index) => (
                      <Cell key={index} fill={index === 4 ? PRIMARY : index === 3 ? PRIMARY_LIGHT : index === 2 ? "#66BB6A" : index === 1 ? "#A5D6A7" : PRIMARY_PALE} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row 3 ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Difficulty Breakdown */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-[#1B5E20]" />
              <h2 className="font-semibold text-gray-900">{t("difficultyBreakdown")}</h2>
            </div>
          </CardHeader>
          <CardContent>
            {difficultyStats.every((d) => d.count === 0) ? (
              <div className="flex h-32 items-center justify-center text-sm text-gray-400">
                {t("noDifficultyData")}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {difficultyStats.map((stat) => (
                  <DifficultyCard
                    key={stat.difficulty}
                    stat={stat}
                    accuracyLabel={t("accuracyLabel", { value: stat.accuracy })}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grade Performance */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[#1B5E20]" />
              <h2 className="font-semibold text-gray-900">{t("gradePerformance")}</h2>
            </div>
          </CardHeader>
          <CardContent>
            {gradeStats.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-gray-400">
                {t("noGradeData")}
              </div>
            ) : gradeStats.length <= 5 ? (
              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-600">{t("gradeLabel", { grade: "" }).trim()}</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">{t("colStudents")}</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">{t("colAvgPoints")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradeStats
                      .sort((a, b) => a.grade - b.grade)
                      .map((g, i) => (
                        <tr key={g.grade} className={`border-b border-gray-50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                          <td className="px-4 py-2 font-medium text-gray-800">
                            {t("gradeLabel", { grade: g.grade })}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600">{g.studentCount}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#1B5E20]">{g.avgPoints.toLocaleString()}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={gradeStats.sort((a, b) => a.grade - b.grade)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="grade" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} tickFormatter={(v) => `Gr ${v}`} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip
                    formatter={(value) => [typeof value === "number" ? value.toLocaleString() : value, t("colAvgPoints")]}
                    labelFormatter={(label) => t("gradeLabel", { grade: label })}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  />
                  <Bar dataKey="avgPoints" name={t("colAvgPoints")} fill={PRIMARY} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Subject × Difficulty Heatmap ── */}
      {subjectDifficultyMatrix && subjectDifficultyMatrix.length > 0 && (
        <SubjectDifficultyHeatmap
          data={subjectDifficultyMatrix}
          title={t("subjectDifficultyAccuracy")}
          desc={t("subjectDifficultyDesc")}
          legendLabel={t("legendLabel")}
          legendGood={t("legendGood")}
          legendFair={t("legendFair")}
          legendNeedsWork={t("legendNeedsWork")}
          legendNoData={t("legendNoData")}
          colSubject={t("colSubject")}
        />
      )}

      {/* ── Subject Detail Table ── */}
      {subjectStats.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-[#1B5E20]" />
              <h2 className="font-semibold text-gray-900">{t("subjectDetails")}</h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-600">{t("colSubject")}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("colQuizzes")}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("colAvgScore")}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">{t("colTotalPoints")}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">{t("colPerformance")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {subjectStats.map((s, i) => (
                    <tr key={s.subject} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                      <td className="px-4 py-3 font-medium text-gray-800">{s.subject}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.quizzes.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#1B5E20]">{s.avgScore}%</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.totalPoints.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${s.avgScore}%`, backgroundColor: SUBJECT_COLORS[i % SUBJECT_COLORS.length] }}
                            />
                          </div>
                          <Badge
                            variant={s.avgScore >= 70 ? "success" : s.avgScore >= 50 ? "warning" : "error"}
                            className="text-xs"
                          >
                            {s.avgScore >= 70 ? t("perfGood") : s.avgScore >= 50 ? t("perfFair") : t("perfNeedsWork")}
                          </Badge>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
