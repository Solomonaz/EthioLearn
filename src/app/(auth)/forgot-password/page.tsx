"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/ui/logo";
import { inputClass, primaryButtonClass } from "@/components/auth/social-sign-in";

/**
 * Ask for a password-reset link. This is also how an admin-created teacher or
 * school admin sets their first password.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setSent(data.message);
    } catch {
      setError(t("networkError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" aria-label={tc("appName")} className="inline-flex justify-center">
            <Logo size="lg" />
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-text-primary">{t("forgotTitle")}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t("forgotSubtitle")}</p>

          {sent ? (
            <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              {sent}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-text-primary">
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
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={isLoading} className={primaryButtonClass}>
                {t("sendLinkBtn")}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t("backToSignIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
