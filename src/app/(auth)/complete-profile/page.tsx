"use client";

import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { useTranslations } from "next-intl";
import { trackSignUp } from "@/components/analytics";
import { GradeOptions } from "@/components/auth/grade-options";
import { homeRouteForRole } from "@/lib/teacher-band";

/**
 * The rest of sign-up for students who came in with Google or Telegram. The
 * provider only proves who they are, so here they confirm the name everyone
 * will see (Telegram names are often nicknames), pick their grade and agree to
 * the terms — the same things the email form asks — before reaching the app.
 */
export default function CompleteProfilePage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const t  = useTranslations("auth");
  const tc = useTranslations("common");

  const [name, setName]           = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [grade, setGrade]         = useState<number | "">("");
  const [agreed, setAgreed]       = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState("");

  const providerName = session?.user?.name ?? "";

  // Prefill with the name Google/Telegram gave us, once the session loads.
  useEffect(() => {
    if (!nameTouched && providerName && providerName !== "Telegram User" && providerName !== "Google User") {
      setName(providerName);
    }
  }, [providerName, nameTouched]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (trimmed.length < 2 || trimmed.length > 50) { setError(t("nameInvalid")); return; }
    if (!grade) { setError(t("selectGradeError")); return; }
    if (!agreed) { setError(t("mustAgree")); return; }
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/students/me/complete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, grade: Number(grade), acceptTerms: true, socialUser: true }),
      });
      const data = await res.json().catch(() => ({}));
      // 409: the grade was already saved (a double submit) — carry on.
      if (!res.ok && res.status !== 409) {
        setError(data.error || "Failed to save. Please try again.");
        return;
      }
      if (res.ok) trackSignUp("social");
      await update();
      router.replace(homeRouteForRole("STUDENT", data.user?.grade ?? null));
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" aria-label={tc("appName")} className="inline-flex justify-center">
            <Logo size="lg" />
          </Link>
          <p className="mt-2 text-text-secondary">{t("finishSignUp")}</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <h2 className="mb-1 text-xl font-semibold text-text-primary">{t("completeProfile")}</h2>
              <p className="text-sm text-text-secondary">{t("gradePersonalise")}</p>
            </div>

            <div>
              <label htmlFor="cp-name" className="mb-1 block text-sm font-medium text-text-primary">
                {t("fullName")}
              </label>
              <input
                id="cp-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
                placeholder={t("enterName")}
                maxLength={50}
                className={inputClass}
                disabled={isLoading || status === "loading"}
              />
              <p className="mt-1.5 text-xs text-text-secondary">{t("nameShownHint")}</p>
            </div>

            <div>
              <label htmlFor="cp-grade" className="mb-1 block text-sm font-medium text-text-primary">
                {t("whatGradeAreYou")}
              </label>
              <select
                id="cp-grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value ? Number(e.target.value) : "")}
                className={inputClass}
                disabled={isLoading}
              >
                <option value="">{t("selectGradeOption")}</option>
                <GradeOptions />
              </select>
              <p className="mt-1.5 text-xs text-text-secondary">{t("gradeHint")}</p>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                disabled={isLoading}
              />
              <span>
                {t.rich("agreeTerms", {
                  terms: (chunks) => (
                    <Link href="/terms" target="_blank" className="font-medium text-primary underline">
                      {chunks}
                    </Link>
                  ),
                  privacy: (chunks) => (
                    <Link href="/privacy" target="_blank" className="font-medium text-primary underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </label>

            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={isLoading || status === "loading"}
              className="w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? t("saving") : t("continueToDashboard")}
            </button>
          </form>
        </div>

        {/* Shared phones: the provider may have signed in the wrong person. */}
        <p className="mt-5 text-center text-sm text-text-secondary">
          {t("notYouPrefix", { name: providerName || "?" })}{" "}
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/register" })}
            className="font-medium text-primary underline"
          >
            {t("useDifferentAccount")}
          </button>
        </p>
      </div>
    </div>
  );
}
