"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";

const TelegramLinkButton = dynamic(
  () => import("@/components/auth/telegram-link-button").then((m) => m.TelegramLinkButton),
  { ssr: false },
);

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

/**
 * "Sign-in methods" for staff profile pages: connect Telegram (so a teacher
 * created by email can sign in with Telegram from then on) and set or change
 * a password. Students have the same controls on their settings page.
 */
export function SignInMethodsCard() {
  // useSearchParams needs a Suspense boundary on prerendered pages.
  return (
    <Suspense fallback={null}>
      <SignInMethods />
    </Suspense>
  );
}

function SignInMethods() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<{ linked: boolean; hasPassword: boolean } | null>(null);

  const linkError = searchParams.get("tg_link_error");
  const justLinked = searchParams.get("tg_linked") === "true";

  useEffect(() => {
    fetch("/api/students/me/link-telegram")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus({ linked: !!d.linked, hasPassword: !!d.hasPassword }))
      .catch(() => {});
  }, [justLinked]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-text-primary">
        <ShieldCheck className="h-5 w-5 text-primary" /> Sign-in methods
      </h2>

      {justLinked && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Telegram linked.</p>
      )}
      {linkError && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {linkError === "network" ? "Network error linking Telegram. Please try again." : linkError}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {TELEGRAM_BOT_USERNAME && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">Telegram</p>
              <p className="text-xs text-text-secondary">
                {status?.linked ? "Linked — you can sign in with Telegram." : "Not linked."}
              </p>
            </div>
            {status && !status.linked && (
              <TelegramLinkButton botUsername={TELEGRAM_BOT_USERNAME} backTo={pathname} />
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Password</p>
            <p className="text-xs text-text-secondary">
              {status?.hasPassword ? "Set." : "Not set — you sign in with Google or Telegram."}
            </p>
          </div>
          <Link
            href="/change-password"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-border/40"
          >
            <KeyRound className="h-4 w-4" />
            {status?.hasPassword ? "Change password" : "Set a password"}
          </Link>
        </div>
      </div>
    </div>
  );
}
