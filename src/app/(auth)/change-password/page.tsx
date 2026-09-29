"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/ui/logo";
import { homeRouteForRole } from "@/lib/teacher-band";
import { inputClass, primaryButtonClass } from "@/components/auth/social-sign-in";

/**
 * Change your password. A student signed in with a school-issued temporary
 * password is sent here by the dashboard and cannot continue until they have
 * chosen their own (`mustChangePassword`).
 */
export default function ChangePasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const user = session?.user as { role?: string; mustChangePassword?: boolean } | undefined;
  const forced = !!user?.mustChangePassword;

  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("passwordsDontMatch"));
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      // Refresh the session so the "must change password" gate clears.
      await update();
      router.replace(homeRouteForRole(user?.role));
    } catch {
      setError(t("networkError"));
    } finally {
      setIsLoading(false);
    }
  }

  if (status !== "authenticated") return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" aria-label={tc("appName")} className="inline-flex justify-center">
            <Logo size="lg" />
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-text-primary">{t("changeTitle")}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {forced ? t("changeSubtitleForced") : t("changeSubtitle")}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="current" className="mb-2 block text-sm font-medium text-text-primary">
                {forced ? t("temporaryPasswordLabel") : t("currentPasswordLabel")}
              </label>
              <input
                id="current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={inputClass}
                disabled={isLoading}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-text-primary">
                {t("newPasswordLabel")}
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
              <label htmlFor="confirm" className="mb-2 block text-sm font-medium text-text-primary">
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={isLoading} className={primaryButtonClass}>
              {t("changeBtn")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
