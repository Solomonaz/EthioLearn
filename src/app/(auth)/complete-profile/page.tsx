"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { useTranslations } from "next-intl";
import { trackSignUp } from "@/components/analytics";

// Student accounts are for grades 9-12 (grades 1-8 have no student accounts).
const GRADES = [9, 10, 11, 12];

export default function CompleteProfilePage() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const t  = useTranslations("auth");
  const tc = useTranslations("common");

  const [grade, setGrade]         = useState<number | "">("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState("");

  const displayName = session?.user?.name ?? "there";

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grade) { setError("Please select your grade."); return; }
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/students/me/complete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: Number(grade), socialUser: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save. Please try again.");
        return;
      }
      trackSignUp("social");
      await update();
      router.replace("/student");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" aria-label={tc("appName")} className="inline-flex justify-center">
            <Logo size="lg" />
          </Link>
          <p className="mt-2 text-text-secondary">{t("completeProfileStep", { name: displayName })}</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <form onSubmit={handleSaveGrade} className="space-y-5">
            <div>
              <h2 className="mb-1 text-xl font-semibold text-text-primary">
                {t("whatGradeAreYou")}
              </h2>
              <p className="mb-5 text-sm text-text-secondary">
                {t("gradePersonalise")}
              </p>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                required
                disabled={isLoading}
              >
                <option value="">{t("selectGradeOption")}</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>{t("gradeN", { grade: g })}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? t("saving") : t("continueToDashboard")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
