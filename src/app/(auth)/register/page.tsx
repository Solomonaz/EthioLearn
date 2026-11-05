"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { useState, useEffect, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { homeRouteForRole } from "@/lib/teacher-band";
import { GradeOptions } from "@/components/auth/grade-options";
import {
  OrDivider,
  SOCIAL_ENABLED,
  SocialSignIn,
  inputClass,
  primaryButtonClass,
} from "@/components/auth/social-sign-in";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";
import { trackSignUp } from "@/components/analytics";

/**
 * What to show when the server's reply carries no message of its own — a
 * crash page, a proxy error or a timeout rather than our JSON. Say what kind
 * of failure it was instead of a bare "failed".
 */
function registerFailureMessage(status: number): string {
  if (status === 409) return "An account with this email already exists. Sign in, or use “Forgot password?” if it’s yours.";
  if (status === 429) return "Too many sign-up attempts from this network. Please wait 10 minutes and try again.";
  if (status === 502 || status === 503 || status === 504) {
    return `The server is not reachable right now (error ${status}). Please try again in a minute.`;
  }
  if (status >= 500) return `Something went wrong on our side (error ${status}). Your account was not created — please try again.`;
  return `Your sign-up could not be sent (error ${status}). Please refresh the page and try again.`;
}

/**
 * Self sign-up — always an independent student. Teachers and school staff are
 * created by their school's admin, and a school's own students get a
 * school-issued username, so neither registers here.
 */
function RegisterForm() {
  const t      = useTranslations("auth");
  const tc     = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const tgError = searchParams.get("tg_error") ?? "";
  const tgErrorMsg = tgError === "failed"
    ? "Telegram sign-up didn't go through. Please try again."
    : "";

  useEffect(() => {
    if (status === "authenticated") {
      const u = session?.user as { role?: string; grade?: number | null } | undefined;
      router.replace(homeRouteForRole(u?.role, u?.grade));
    }
  }, [status, session, router]);

  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [grade, setGrade]       = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]       = useState(tgErrorMsg);
  // Set once the account exists: it must be confirmed by email before use.
  const [sentTo, setSentTo]     = useState<string | null>(null);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("passwordsDontMatch"));
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: name.trim(), email: email.trim(), password, grade: Number(grade) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || registerFailureMessage(res.status));
        return;
      }

      trackSignUp("email");
      // The account can't be used until the email is confirmed.
      setSentTo(data.email ?? email.trim().toLowerCase());
    } catch {
      setError(t("networkError"));
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
          <p className="mt-2 text-text-secondary">{t("registerSubtitle")}</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          {sentTo ? (
            <CheckEmailPanel email={sentTo} />
          ) : (
          <>
          <SocialSignIn
            action="register"
            googleLabel={t("signUpGoogle")}
            googleLoadingLabel={t("signUpGoogleLoading")}
            onError={setError}
          />
          {SOCIAL_ENABLED && <OrDivider label={t("orUseEmail")} />}

          <form onSubmit={handleCreateAccount} className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-text-primary">
                {t("fullName")}
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                placeholder={t("enterName")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                required
                minLength={2}
                maxLength={50}
                disabled={isLoading}
              />
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-text-primary">
                {t("emailLabel")}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-text-primary">
                {t("passwordLabel")}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                required
                minLength={6}
                disabled={isLoading}
              />
              <p className="mt-1 text-xs text-text-muted">{t("passwordHint")}</p>
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-text-primary">
                {t("confirmPasswordLabel")}
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label htmlFor="grade" className="mb-1 block text-sm font-medium text-text-primary">
                {t("grade")}
              </label>
              <select
                id="grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className={inputClass}
                required
                disabled={isLoading}
              >
                <option value="">{t("selectGradeOption")}</option>
                <GradeOptions />
              </select>
              <p className="mt-1.5 text-xs text-text-secondary">{t("gradeHint")}</p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={isLoading} className={primaryButtonClass}>
              {isLoading ? t("creating") : t("createAccountBtn")}
            </button>
          </form>
          </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-text-secondary">
          {t("haveAccount")}{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {tc("signIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
