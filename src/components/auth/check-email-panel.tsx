"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * "Confirm your email" notice with a resend button. Shown after sign-up, and
 * on the sign-in page when a password is right but the email is unconfirmed.
 */
export function CheckEmailPanel({ email, compact = false }: { email: string; compact?: boolean }) {
  const t = useTranslations("auth");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function resend() {
    setState("sending");
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || t("networkError"));
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setMessage(t("networkError"));
      setState("error");
    }
  }

  return (
    <div className={compact ? "rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" : "text-center"}>
      {!compact && <MailCheck className="mx-auto mb-3 h-12 w-12 text-primary" aria-hidden="true" />}
      {!compact && <h2 className="text-xl font-semibold text-text-primary">{t("checkEmailTitle")}</h2>}
      <p className={compact ? "" : "mt-2 text-sm text-text-secondary"}>
        {t.rich("checkEmailBody", { email, b: (chunks) => <strong>{chunks}</strong> })}
      </p>
      <div className={compact ? "mt-2" : "mt-5"}>
        {state === "sent" ? (
          <p className="text-sm font-medium text-green-700">{t("linkResent")}</p>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={state === "sending"}
            className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
          >
            {t("resendLink")}
          </button>
        )}
        {state === "error" && <p className="mt-1 text-sm text-red-600">{message}</p>}
      </div>
    </div>
  );
}
