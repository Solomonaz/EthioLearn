"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { homeRouteForRole } from "@/lib/teacher-band";
import { useState, Suspense, useEffect } from "react";
import { signIn, getSession, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  OrDivider,
  SOCIAL_ENABLED,
  SocialSignIn,
  inputClass,
  primaryButtonClass,
} from "@/components/auth/social-sign-in";

// ── Error messages ───────────────────────────────────────────────────────────
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  SessionRevoked: "Your session was signed out from another device. Please sign in again.",
  OAuthCallback:  "Social sign-in failed. Please try again.",
  Default:        "Sign-in failed. Please try again.",
};

function LoginForm() {
  const t      = useTranslations("auth");
  const tc     = useTranslations("common");
  const router = useRouter();
  const { data: session, status } = useSession();
  const searchParams   = useSearchParams();
  const justRegistered = searchParams.get("registered") === "true";
  const passwordReset  = searchParams.get("reset") === "1";
  const callbackUrl    = searchParams.get("callbackUrl") ?? "";
  const errorCode      = searchParams.get("error") ?? "";
  const tgError        = searchParams.get("tg_error") ?? "";
  const tgErrorMsg     = tgError === "already_exists"
    ? "This Telegram account is already registered. Please sign in."
    : "";
  const initialError   = tgErrorMsg ||
    (AUTH_ERROR_MESSAGES[errorCode] ?? (errorCode ? AUTH_ERROR_MESSAGES.Default : ""));

  // Set by a dashboard layout that just turned this session away (deactivated
  // or deleted account) — see proxy.ts.
  const rejected = searchParams.get("rejected") === "1";

  useEffect(() => {
    // Auto-redirecting a rejected session back would loop, so show the form
    // and let them sign in again. Anyone else who is signed in leaves.
    if (status === "authenticated" && !rejected) {
      const role = (session?.user as any)?.role;
      router.replace(homeRouteForRole(role));
    }
  }, [status, session, router, rejected]);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]     = useState("");
  const [isLoading, setIsLoading]   = useState(false);
  const [error, setError]           = useState(initialError);

  // ── Email / username + password ──────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const result = await signIn("password", {
        identifier: identifier.trim(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error === "TooManyAttempts" ? t("tooManyAttempts") : t("wrongCredentials"));
        return;
      }

      if (result?.ok) {
        const sess = await getSession();
        const user = sess?.user as { role?: string; mustChangePassword?: boolean; profileIncomplete?: boolean } | undefined;

        // A school-issued temporary password must be replaced first.
        if (user?.mustChangePassword) {
          router.replace("/change-password");
          return;
        }
        if (user?.profileIncomplete) {
          router.replace("/complete-profile");
          return;
        }

        const home = homeRouteForRole(user?.role);
        if (callbackUrl) {
          const isSafeRelative = /^\/[^/]/.test(callbackUrl) && !callbackUrl.includes(":");
          // Follow a callbackUrl only when it lives under this role's own home
          // segment, matched on a path boundary so "/admin" cannot authorise
          // "/admin-something" (and "/teacher" cannot authorise
          // "/secondary-teacher", or the reverse).
          const isOwnSurface =
            callbackUrl === home ||
            callbackUrl.startsWith(home + "/") ||
            callbackUrl.startsWith(home + "?");
          // `replace`, not `push`: the login page must not stay in history,
          // or Back from the dashboard lands on a login form for a signed-in
          // user.
          if (isSafeRelative && isOwnSurface) {
            router.replace(callbackUrl);
            return;
          }
        }
        router.replace(home);
      }
    } catch {
      setError(t("networkError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="mb-8 text-center">
          <Link href="/" aria-label={tc("appName")} className="inline-flex justify-center"><Logo size="lg" /></Link>
          <p className="mt-2 text-text-secondary">{t("signInSubtitle")}</p>
        </div>

        {justRegistered && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-center text-sm text-green-700">
            {t("accountCreated")}
          </div>
        )}
        {passwordReset && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-center text-sm text-green-700">
            {t("resetDone")}
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">

          <SocialSignIn
            action="login"
            googleLabel={t("continueGoogle")}
            googleLoadingLabel={t("continueGoogleLoading")}
            onError={setError}
          />
          {SOCIAL_ENABLED && <OrDivider label={t("orUseEmail")} />}

          {/* ── Email or username + password ─────────────────────────────── */}
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label htmlFor="identifier" className="mb-2 block text-sm font-medium text-text-primary">
                {t("emailOrUsername")}
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputClass}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-text-primary">
                  {t("passwordLabel")}
                </label>
                <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                  {t("forgotPassword")}
                </Link>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                required
                disabled={isLoading}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={isLoading} className={primaryButtonClass}>
              {isLoading ? t("signingIn") : t("signInBtn")}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-text-secondary">
          {t("noAccount")}{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            {tc("register")}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
