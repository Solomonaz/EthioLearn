"use client";

/**
 * TelegramLinkButton — for the Settings page "Connected Accounts" section.
 *
 * Redirects to Telegram's OAuth confirmation page so the user explicitly
 * approves the link.  On return, /auth/telegram-callback?tg_action=link
 * calls POST /api/students/me/link-telegram and redirects to settings.
 */

const BOT_ID = process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID ?? "";

interface TelegramLinkButtonProps {
  botUsername: string; // kept for display consistency, not used to build URL
}

export function TelegramLinkButton({ botUsername: _botUsername }: TelegramLinkButtonProps) {
  const handleClick = () => {
    if (!BOT_ID) {
      console.error("NEXT_PUBLIC_TELEGRAM_BOT_ID is not set");
      return;
    }

    const origin   = window.location.origin;
    // Note: (auth) is a Next.js route group — the URL is /telegram-callback, NOT /auth/telegram-callback
    const returnTo = `${origin}/telegram-callback?tg_action=link`;

    const telegramAuthUrl =
      `https://oauth.telegram.org/auth` +
      `?bot_id=${BOT_ID}` +
      `&origin=${encodeURIComponent(origin)}` +
      `&request_access=write` +
      `&return_to=${encodeURIComponent(returnTo)}`;

    window.location.href = telegramAuthUrl;
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 rounded-lg bg-[#229ED9] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
    >
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
      </svg>
      Link Telegram Account
    </button>
  );
}
