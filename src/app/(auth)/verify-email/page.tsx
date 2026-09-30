"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { primaryButtonClass } from "@/components/auth/social-sign-in";

/** Landing page of the "Confirm my email" link sent at sign-up. */
function VerifyEmail() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">(token ? "working" : "failed");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // the link is single-use: never submit it twice
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => setState(r.ok ? "done" : "failed"))
      .catch(() => setState("failed"));
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" aria-label={tc("appName")} className="inline-flex justify-center">
            <Logo size="lg" />
          </Link>
        </div>
        <div className="rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
          {state === "working" && <p className="text-text-secondary">{t("verifyingEmail")}</p>}
          {state === "done" && (
            <>
              <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-600" aria-hidden="true" />
              <h1 className="text-xl font-semibold text-text-primary">{t("emailVerifiedTitle")}</h1>
              <p className="mt-2 text-sm text-text-secondary">{t("emailVerifiedBody")}</p>
            </>
          )}
          {state === "failed" && (
            <>
              <XCircle className="mx-auto mb-3 h-12 w-12 text-red-500" aria-hidden="true" />
              <p className="text-sm text-text-secondary">{t("verifyFailed")}</p>
            </>
          )}
          {state !== "working" && (
            <Link href="/login" className={`mt-6 inline-block ${primaryButtonClass}`}>
              {t("goToSignIn")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}
