"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { useState, useEffect, Suspense } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { homeRouteForRole } from "@/lib/teacher-band";

const TelegramLoginButton = dynamic(
  () => import("@/components/auth/telegram-login").then((m) => m.TelegramLoginButton),
  { ssr: false, loading: () => <div className="h-10" /> }
);

const GOOGLE_ENABLED        = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";
const FACEBOOK_ENABLED      = process.env.NEXT_PUBLIC_FACEBOOK_ENABLED === "true";
const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
const TELEGRAM_ENABLED      = TELEGRAM_BOT_USERNAME.length > 0;
const PHONE_ENABLED         = process.env.NEXT_PUBLIC_PHONE_ENABLED !== "false"; // default on
const SOCIAL_ENABLED        = GOOGLE_ENABLED || FACEBOOK_ENABLED || TELEGRAM_ENABLED;

function RegisterForm() {
  const t      = useTranslations("auth");
  const tc     = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const tgError = searchParams.get("tg_error") ?? "";
  const tgErrorMsg = tgError === "no_account"
    ? "No Telegram account found. Please register with your Telegram below."
    : "";

  useEffect(() => {
    if (status === "authenticated") {
      const role = (session?.user as { role?: string } | undefined)?.role;
      router.replace(homeRouteForRole(role));
    }
  }, [status, session, router]);

  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [step, setStep]               = useState<"phone" | "otp" | "profile">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp]                 = useState("");
  const [name, setName]               = useState("");
  const [grade, setGrade]             = useState("");
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState("");

  // ── Social sign-up ────────────────────────────────────────────────────────
  const handleSocialSignUp = async (provider: string) => {
    setSocialLoading(provider);
    try {
      await signIn(provider, { callbackUrl: "/auth/redirect" });
    } catch {
      setSocialLoading(null);
    }
  };

  // ── Step 1: Send OTP ─────────────────────────────────────────────────────
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res  = await fetch("/api/auth/otp/send", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phoneNumber: "+251" + phoneNumber, purpose: "register" }),
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

  // ── Step 2: Verify OTP ───────────────────────────────────────────────────
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res  = await fetch("/api/auth/otp/verify", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phoneNumber: "+251" + phoneNumber, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid OTP. Please try again.");
        return;
      }
      setStep("profile");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 3: Create account ───────────────────────────────────────────────
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res  = await fetch("/api/auth/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phoneNumber: "+251" + phoneNumber, name, role: "STUDENT", grade }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create account. Please try again.");
        return;
      }
      router.push("/login?registered=true");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const steps = ["phone", "otp", "profile"] as const;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" aria-label={tc("appName")} className="inline-flex justify-center">
            <Logo size="lg" />
          </Link>
          <p className="mt-2 text-text-secondary">{t("registerSubtitle")}</p>
        </div>

        {tgErrorMsg && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-center text-sm text-blue-700">
            {tgErrorMsg}
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">

          {/* Sign-up is for students only. Teachers of every grade are
              created by their school's admin and simply sign in. */}
          {step === "phone" && (
            <p className="mb-6 rounded-lg bg-primary/5 px-3 py-2 text-xs text-text-secondary">
              {t("teacherSignupNote")}
            </p>
          )}

          {/* ── Social sign-up buttons (students only — social auto-creates a
                student account) ─────────────────────────────────────────── */}
          {SOCIAL_ENABLED && step === "phone" && (
            <div className="mb-6 space-y-3">
              {GOOGLE_ENABLED && (
                <button
                  type="button"
                  onClick={() => handleSocialSignUp("google")}
                  disabled={socialLoading !== null}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-white py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {socialLoading === "google" ? t("signUpGoogleLoading") : t("signUpGoogle")}
                </button>
              )}

              {FACEBOOK_ENABLED && (
                <button
                  type="button"
                  onClick={() => handleSocialSignUp("facebook")}
                  disabled={socialLoading !== null}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-[#1877F2] bg-[#1877F2] py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                  </svg>
                  {socialLoading === "facebook" ? "Signing up…" : "Sign up with Facebook"}
                </button>
              )}

              {TELEGRAM_ENABLED && (
                <TelegramLoginButton botUsername={TELEGRAM_BOT_USERNAME} callbackUrl="/auth/redirect" action="register" />
              )}

              {PHONE_ENABLED && (
                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-text-secondary">{t("orRegisterPhone")}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
            </div>
          )}

          {/* ── Phone registration steps ──────────────────────────────────── */}
          {PHONE_ENABLED && (
            <>
              {/* Step indicator */}
              <div className="mb-6 flex justify-center gap-2">
                {steps.map((s, i) => (
                  <div
                    key={s}
                    className={`h-2 w-8 rounded-full ${
                      steps.indexOf(step) >= i ? "bg-primary" : "bg-border"
                    }`}
                  />
                ))}
              </div>

              {/* ── Step 1: Phone ─────────────────────────────────────────── */}
              {step === "phone" && (
                <form onSubmit={handleSendOtp}>
                  <h2 className="mb-4 text-lg font-semibold text-text-primary">
                    {t("yourPhoneNumber")}
                  </h2>
                  <div className="flex gap-2">
                    <span className="flex items-center rounded-lg border border-border bg-gray-50 px-3 text-sm text-text-secondary">
                      +251
                    </span>
                    <input
                      type="tel"
                      placeholder="9XXXXXXXX"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ""))}
                      className="w-full rounded-lg border border-border px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      maxLength={9}
                      minLength={9}
                      pattern="[0-9]{9}"
                      title="Enter exactly 9 digits (e.g. 912345678)"
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
                    {isLoading ? t("sending") : t("sendOtp")}
                  </button>
                </form>
              )}

              {/* ── Step 2: OTP ───────────────────────────────────────────── */}
              {step === "otp" && (
                <form onSubmit={handleVerifyOtp}>
                  <h2 className="mb-2 text-lg font-semibold text-text-primary">
                    {t("verifyNumber")}
                  </h2>
                  <p className="mb-4 text-sm text-text-secondary">
                    {t("enterCode6")}{" "}
                    <span className="font-medium text-text-primary">+251{phoneNumber}</span>
                  </p>
                  <input
                    type="text"
                    placeholder="000000"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="w-full rounded-lg border border-border px-4 py-3 text-center text-2xl tracking-widest text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    maxLength={6}
                    required
                    disabled={isLoading}
                  />
                  {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? t("verifying") : t("verify")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep("phone"); setError(""); setOtp(""); }}
                    className="mt-3 w-full text-sm text-text-secondary hover:text-primary"
                    disabled={isLoading}
                  >
                    {tc("back")}
                  </button>
                </form>
              )}

              {/* ── Step 3: Profile ───────────────────────────────────────── */}
              {step === "profile" && (
                <form onSubmit={handleCreateAccount}>
                  <h2 className="mb-4 text-lg font-semibold text-text-primary">
                    {t("completeProfile")}
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-primary">
                        {t("fullName")}
                      </label>
                      <input
                        type="text"
                        placeholder={t("enterName")}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-border px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        required
                        disabled={isLoading}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-primary">
                        {t("grade")}
                      </label>
                      <select
                        value={grade}
                        onChange={(e) => setGrade(e.target.value)}
                        className="w-full rounded-lg border border-border px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        required
                        disabled={isLoading}
                      >
                        <option value="">{t("selectGradeOption")}</option>
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {t("gradeN", { grade: i + 1 })}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? t("creating") : tc("create")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep("otp"); setError(""); }}
                    className="mt-3 w-full text-sm text-text-secondary hover:text-primary"
                    disabled={isLoading}
                  >
                    {tc("back")}
                  </button>
                </form>
              )}
            </>
          )}

          {/* ── Fallback: nothing enabled ──────────────────────────────────── */}
          {!PHONE_ENABLED && !SOCIAL_ENABLED && (
            <p className="text-center text-sm text-text-secondary">
              {t("noRegisterMethods")}
            </p>
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
