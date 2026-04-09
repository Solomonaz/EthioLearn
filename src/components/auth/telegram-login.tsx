"use client";

/**
 * TelegramLoginButton
 *
 * Uses the Telegram OAuth URL (NOT the JS widget) so that clicking the button
 * ALWAYS opens Telegram's own confirmation page — no silent auto-fire for
 * Telegram Web users, no intermediate "Continue as X?" card needed.
 *
 * Flow:
 *   1. User clicks our button
 *   2. We redirect the page to https://oauth.telegram.org/auth?…&return_to=/auth/telegram-callback?tg_action=<action>
 *   3. Telegram shows its confirmation UI (the user explicitly taps Confirm)
 *   4. Telegram redirects to /auth/telegram-callback with auth params in the URL
 *   5. That page calls NextAuth signIn("telegram", { action, telegramData })
 *   6. On success → /auth/redirect; on error → back to /login or /register
 */

import { useRouter } from "next/navigation";

interface TelegramLoginButtonProps {
  botUsername: string; // kept for aria-label / display — not used to build URL
  callbackUrl?: string; // unused here; callback routing is handled by /auth/telegram-callback
  /**
   * "login"    → find existing account; if none → redirect to /register
   * "register" → create new account;    if exists → redirect to /login
   */
  action: "login" | "register";
}

const BOT_ID = process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID ?? "";

export function TelegramLoginButton({ action }: TelegramLoginButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (!BOT_ID) {
      console.error("NEXT_PUBLIC_TELEGRAM_BOT_ID is not set");
      return;
    }

    // Build the return_to URL — Telegram will append its auth params here
    const origin   = window.location.origin;
    // Note: (auth) is a Next.js route group — the URL is /telegram-callback, NOT /auth/telegram-callback
    const returnTo = `${origin}/telegram-callback?tg_action=${action}`;

    // Telegram OAuth URL — always shows an explicit confirmation page
    const telegramAuthUrl =
      `https://oauth.telegram.org/auth` +
      `?bot_id=${BOT_ID}` +
      `&origin=${encodeURIComponent(origin)}` +
      `&request_access=write` +
      `&return_to=${encodeURIComponent(returnTo)}`;

    router.push(telegramAuthUrl);
  };

  const label = action === "register" ? "Sign up with Telegram" : "Sign in with Telegram";

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center justify-center gap-3 rounded-lg bg-[#229ED9] py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
      aria-label={label}
    >
      {/* Telegram plane icon */}
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
      </svg>
      {label}
    </button>
  );
}
