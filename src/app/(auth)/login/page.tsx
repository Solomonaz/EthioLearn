"use client";

import Link from "next/link";
import { useState, Suspense, useEffect } from "react";
import { signIn, getSession, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

// Lazily load the Telegram widget (it injects a third-party script)
const TelegramLoginButton = dynamic(
  () =>
    import("@/components/auth/telegram-login").then(
      (m) => m.TelegramLoginButton
    ),
  { ssr: false, loading: () => <div className="h-10" /> }
);

// ── Env flags exposed to the client ────────────────────────────────────────
const GOOGLE_ENABLED =
  process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";
const TELEGRAM_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
const TELEGRAM_ENABLED = TELEGRAM_BOT_USERNAME.length > 0;

const SOCIAL_ENABLED = GOOGLE_ENABLED || TELEGRAM_ENABLED;

// ── Error messages for NextAuth error codes ──────────────────────────────────
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  GoogleAccountNotLinked:
    "No EthioLearn account is linked to that Google email. " +
    "Please register first, then add your email in Settings.",
  SessionRevoked:
    "Your session was signed out from another device. Please sign in again.",
  OAuthCallback: "Google sign-in failed. Please try again.",
  Default: "Sign-in failed. Please try again.",
};

function LoginForm() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "true";
  const callbackUrl = searchParams.get("callbackUrl") ?? "";

  // Surface NextAuth error codes passed via ?error=
  const errorCode = searchParams.get("error") ?? "";
  const initialError = AUTH_ERROR_MESSAGES[errorCode] ?? "";

  // If the user is already authenticated, redirect them to their dashboard.
  useEffect(() => {
    if (status === "authenticated") {
      const role = (session?.user as { role?: string } | undefined)?.role;
      const isAdmin = role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN";
      router.replace(isAdmin ? "/admin" : "/student");
    }
  }, [status, session, router]);

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSocialLoading, setIsSocialLoading] = useState<
    "google" | "telegram" | null
  >(null);
  const [error, setError] = useState(initialError);

  // ── OTP flow ─────────────────────────────────────────────────────────────

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "+251" + phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send OTP. Please try again.");
        return;
      }
      setStep("otp");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const result = await signIn("credentials", {
        phoneNumber: "+251" + phoneNumber,
        otp,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid OTP or account not found.");
        return;
      }

      if (result?.ok) {
        const session = await getSession();
        const role = (session?.user as { role?: string } | undefined)?.role;
        const isAdmin = role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN";

        if (callbackUrl) {
          const isAdminCallback = callbackUrl.startsWith("/admin");
          const isStudentCallback = callbackUrl.startsWith("/student");
          if (
            (isAdmin && isAdminCallback) ||
            (!isAdmin && isStudentCallback)
          ) {
            router.push(callbackUrl);
            return;
          }
        }

        router.push(isAdmin ? "/admin" : "/student");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Google sign-in ───────────────────────────────────────────────────────

  const handleGoogleSignIn = async () => {
    setError("");
    setIsSocialLoading("google");
    try {
      await signIn("google", { callbackUrl: "/auth/redirect" });
      // NextAuth handles the redirect; no further action needed here
    } catch {
      setError("Google sign-in failed. Please try again.");
      setIsSocialLoading(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Link href="/" className="text-3xl font-bold text-primary">
            EthioLearn
          </Link>
          <p className="mt-2 text-text-secondary">Sign in to your account</p>
        </div>

        {/* Success banner */}
        {justRegistered && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-center text-sm text-green-700">
            Account created! Please sign in.
          </div>
        )}

        {/* Main card */}
        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          {step === "phone" ? (
            <form onSubmit={handleSendOtp}>
              <label className="mb-2 block text-sm font-medium text-text-primary">
                Phone Number
              </label>
              <div className="flex gap-2">
                <span className="flex items-center rounded-lg border border-border bg-gray-50 px-3 text-sm text-text-secondary">
                  +251
                </span>
                <input
                  type="tel"
                  placeholder="9XXXXXXXX"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full rounded-lg border border-border px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  maxLength={9}
                  required
                  disabled={isLoading}
                />
              </div>
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Sending…" : "Send OTP"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <p className="mb-4 text-sm text-text-secondary">
                We sent a 6-digit code to +251{phoneNumber}
              </p>
              <label className="mb-2 block text-sm font-medium text-text-primary">
                Enter OTP
              </label>
              <input
                type="text"
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="w-full rounded-lg border border-border px-4 py-3 text-center text-2xl tracking-widest text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                maxLength={6}
                required
                disabled={isLoading}
                autoFocus
              />
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Verifying…" : "Verify & Sign In"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError("");
                  setOtp("");
                }}
                className="mt-3 w-full text-sm text-text-secondary hover:text-primary"
                disabled={isLoading}
              >
                Change phone number
              </button>
            </form>
          )}

          {/* ── Social login divider ─────────────────────────────────────── */}
          {SOCIAL_ENABLED && (
            <>
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-text-secondary">or continue with</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="space-y-3">
                {/* ── Google ────────────────────────────────────────────── */}
                {GOOGLE_ENABLED && (
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isSocialLoading !== null}
                    className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-white py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {/* Google SVG icon */}
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    {isSocialLoading === "google"
                      ? "Signing in…"
                      : "Continue with Google"}
                  </button>
                )}

                {/* ── Telegram ──────────────────────────────────────────── */}
                {TELEGRAM_ENABLED && (
                  <div>
                    <TelegramLoginButton
                      botUsername={TELEGRAM_BOT_USERNAME}
                      callbackUrl="/auth/redirect"
                    />
                  </div>
                )}
              </div>

              <p className="mt-4 text-center text-xs text-text-secondary">
                Social sign-in requires a linked EthioLearn account.
              </p>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-medium text-primary hover:underline"
          >
            Register
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
