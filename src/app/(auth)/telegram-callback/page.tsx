"use client";

/**
 * /auth/telegram-callback
 *
 * Telegram OAuth redirects here after the user confirms on its own page.
 * The auth result arrives as a URL hash fragment:
 *   #tgAuthResult=<base64-encoded-JSON>
 *
 * We also set tg_action=<login|register|link> in the query string ourselves
 * so we know what to do with the result.
 */

import { Suspense, useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-text-secondary">Please wait…</p>
      </div>
    </div>
  );
}

function TelegramCallbackInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const called       = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const action = searchParams.get("tg_action") ?? "login";
    // Where a "link" returns to. Only a same-origin path is accepted, so the
    // parameter cannot send anyone off-site.
    const backParam = searchParams.get("back") ?? "";
    const linkBack = /^\/[A-Za-z0-9/_-]*$/.test(backParam) ? backParam : "/student/settings";

    // ── Parse the hash fragment ────────────────────────────────────────────
    // Telegram appends: #tgAuthResult=<base64url-encoded JSON>
    const hash = window.location.hash; // e.g. "#tgAuthResult=eyJpZ..."

    if (!hash || !hash.includes("tgAuthResult=")) {
      // User cancelled or navigated here directly — go back
      const fallback = action === "register" ? "/register"
                     : action === "link"     ? linkBack
                     :                         "/login";
      router.replace(fallback);
      return;
    }

    let telegramData: Record<string, string> | null = null;
    try {
      const encoded = hash.split("tgAuthResult=")[1];
      // Telegram uses standard base64 (may need padding)
      const padded  = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
      const decoded = atob(padded);
      telegramData  = JSON.parse(decoded);
    } catch {
      // Malformed hash — send back to start
      router.replace(action === "register" ? "/register" : "/login");
      return;
    }

    if (!telegramData || !telegramData.hash) {
      router.replace(action === "register" ? "/register" : "/login");
      return;
    }

    (async () => {
      // ── Link existing account ────────────────────────────────────────────
      if (action === "link") {
        try {
          const res = await fetch("/api/students/me/link-telegram", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ telegramData: JSON.stringify(telegramData) }),
          });
          const data = await res.json();
          if (!res.ok) {
            router.replace(
              `${linkBack}?tg_link_error=${encodeURIComponent(data.error ?? "Failed to link")}`,
            );
          } else {
            router.replace(`${linkBack}?tg_linked=true`);
          }
        } catch {
          router.replace(`${linkBack}?tg_link_error=network`);
        }
        return;
      }

      // ── Login or Register ────────────────────────────────────────────────
      const result = await signIn("telegram", {
        telegramData: JSON.stringify(telegramData),
        action,
        redirect: false,
      });

      if (!result?.ok || result?.error) {
        const error = result?.error ?? "";
        if (error === "NoAccount") {
          router.replace("/register?tg_error=no_account");
          return;
        }
        if (error === "AlreadyExists") {
          router.replace("/login?tg_error=already_exists");
          return;
        }
        router.replace(action === "register" ? "/register" : "/login");
        return;
      }

      // Success → /auth/redirect decides where to send them (dashboard or complete-profile)
      router.replace("/auth/redirect");
    })();
  }, [searchParams, router]);

  return <Spinner />;
}

export default function TelegramCallbackPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TelegramCallbackInner />
    </Suspense>
  );
}
