/**
 * Outbound Telegram messages from the Abugida bot (the same bot that powers
 * Telegram sign-in). The bot may message a user who signed in with or linked
 * Telegram, because both flows ask Telegram for write access.
 */

export type TelegramSendResult =
  | { ok: true }
  /** The user blocked the bot, deleted their account, or never allowed messages. */
  | { ok: false; unreachable: true; error: string }
  /** Flood limit: stop and try later. */
  | { ok: false; retryAfterSec: number; error: string }
  | { ok: false; error: string };

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

function apiBase(): string {
  // Overridable for tests (a local mock of the Bot API).
  return (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Send `text` (plain text; it is HTML-escaped here) with an "open" button.
 * Telegram only accepts https button URLs, so in local development (http)
 * the link goes in the text instead.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  button?: { label: string; url: string },
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };

  let body = escapeHtml(text);
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (button) {
    if (button.url.startsWith("https://")) {
      payload.reply_markup = { inline_keyboard: [[{ text: button.label, url: button.url }]] };
    } else {
      body += `\n\n${escapeHtml(button.url)}`;
    }
  }
  payload.text = body;

  try {
    const res = await fetch(`${apiBase()}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (res.ok && json.ok) return { ok: true };
    const error = json.description || `HTTP ${res.status}`;
    if (res.status === 429) return { ok: false, retryAfterSec: json.parameters?.retry_after ?? 30, error };
    // 403: blocked / deactivated / can't initiate. 400 "chat not found": never
    // allowed the bot to write. Neither will succeed if retried.
    if (res.status === 403 || (res.status === 400 && /chat not found|user not found/i.test(error))) {
      return { ok: false, unreachable: true, error };
    }
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
