"use client";

import Link from "next/link";
import { Activity, CreditCard, GraduationCap, Puzzle, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/shared/stat-card";

export interface ElementaryDashboardData {
  level: "ELEMENTARY";
  stats: {
    totalTeachers: number;
    activeTeachers: number;
    gameSets: number;
    aiCreditsThisMonth: number;
  };
  /** Monthly AI credits each teacher may spend; null = no cap. */
  aiCreditLimit: number | null;
  /** False when pricing is on and the school has no live subscription; null with no teachers yet. */
  subscriptionActive: boolean | null;
  teachers: {
    id: string;
    name: string;
    isActive: boolean;
    lastActiveAt: string | null;
    gameSets: number;
    aiCredits: number;
  }[];
}

/**
 * Dashboard for an elementary school's admin. The school has no students on
 * the platform, so this is about its teachers: who is using Abugida, what
 * they have built, and how much of their AI allowance they have used.
 */
export function ElementarySchoolDashboard({ data }: { data: ElementaryDashboardData }) {
  const { stats, teachers, aiCreditLimit, subscriptionActive } = data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">School Dashboard</h1>
        <p className="text-sm text-text-secondary">
          How your teachers are using Abugida in their classrooms
        </p>
      </div>

      {subscriptionActive === false && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm text-text-primary">
            Your school&apos;s subscription is not active, so your teachers&apos; AI game
            writing is paused. Their classroom games still work.
          </p>
          <Link href="/school-admin/subscription">
            <Button size="sm" variant="outline">
              <CreditCard className="mr-1.5 h-4 w-4" /> View subscription
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Teachers" value={stats.totalTeachers} icon={GraduationCap} />
        <StatCard label="Active (7d)" value={stats.activeTeachers} icon={Activity} />
        <StatCard label="Game sets built" value={stats.gameSets} icon={Puzzle} />
        <StatCard label="AI credits this month" value={stats.aiCreditsThisMonth} icon={Sparkles} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-text-primary">Teachers</h2>
            <Link href="/school-admin/teachers">
              <Button size="sm" variant="outline">Manage teachers</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {teachers.length === 0 ? (
            <div className="py-10 text-center">
              <GraduationCap className="mx-auto mb-2 h-8 w-8 text-text-muted" />
              <p className="text-sm text-text-secondary">
                No teachers yet. Add your teachers so they can sign in with their phone number.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-text-muted">
                    <th className="py-2 pr-3 font-semibold">Teacher</th>
                    <th className="py-2 pr-3 font-semibold">Last active</th>
                    <th className="py-2 pr-3 text-right font-semibold">Game sets</th>
                    <th className="py-2 text-right font-semibold">AI credits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {teachers.map((t) => (
                    <tr key={t.id} className={t.isActive ? "" : "opacity-50"}>
                      <td className="py-2.5 pr-3 font-medium text-text-primary">
                        {t.name}
                        {!t.isActive && (
                          <span className="ml-2 text-[11px] font-semibold text-red-600">
                            Deactivated
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-text-secondary">
                        {t.lastActiveAt
                          ? new Date(t.lastActiveAt).toLocaleDateString()
                          : "Never signed in"}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-text-primary">{t.gameSets}</td>
                      <td className="py-2.5 text-right text-text-primary">
                        {t.aiCredits}
                        {aiCreditLimit !== null && (
                          <span className="text-text-muted"> / {aiCreditLimit}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
