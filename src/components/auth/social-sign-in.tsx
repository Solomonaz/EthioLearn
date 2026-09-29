"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import dynamic from "next/dynamic";

const TelegramLoginButton = dynamic(
  () => import("@/components/auth/telegram-login").then((m) => m.TelegramLoginButton),
  { ssr: false, loading: () => <div className="h-10" /> }
);

export const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";
const FACEBOOK_ENABLED = process.env.NEXT_PUBLIC_FACEBOOK_ENABLED === "true";
const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
const TELEGRAM_ENABLED = TELEGRAM_BOT_USERNAME.length > 0;
export const SOCIAL_ENABLED = GOOGLE_ENABLED || FACEBOOK_ENABLED || TELEGRAM_ENABLED;

/**
 * Google / Facebook / Telegram buttons, shared by the sign-in and sign-up
 * pages. `action` is passed to Telegram, which must know whether to find an
 * existing account ("login") or create one ("register"); Google finds the
 * account by email either way.
 */
export function SocialSignIn({
  action,
  googleLabel,
  googleLoadingLabel,
  onError,
}: {
  action: "login" | "register";
  googleLabel: string;
  googleLoadingLabel: string;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  async function go(provider: string) {
    onError("");
    setLoading(provider);
    try {
      await signIn(provider, { callbackUrl: "/auth/redirect" });
    } catch {
      onError("Sign-in failed. Please try again.");
      setLoading(null);
    }
  }

  if (!SOCIAL_ENABLED) return null;

  return (
    <div className="space-y-3">
      {GOOGLE_ENABLED && (
        <button
          type="button"
          onClick={() => go("google")}
          disabled={loading !== null}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-white py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {loading === "google" ? googleLoadingLabel : googleLabel}
        </button>
      )}

      {FACEBOOK_ENABLED && (
        <button
          type="button"
          onClick={() => go("facebook")}
          disabled={loading !== null}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-[#1877F2] bg-[#1877F2] py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
          </svg>
          {loading === "facebook" ? "Signing in…" : "Continue with Facebook"}
        </button>
      )}

      {TELEGRAM_ENABLED && (
        <TelegramLoginButton botUsername={TELEGRAM_BOT_USERNAME} callbackUrl="/auth/redirect" action={action} />
      )}
    </div>
  );
}

/** "──── or use your email ────" divider. */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-text-secondary">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60";

export const primaryButtonClass =
  "w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50";
