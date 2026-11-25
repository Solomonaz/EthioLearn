"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, Mail, RotateCcw, WifiOff } from "lucide-react";
import { GuideMascot } from "@/components/student/guide-mascot";
import { LEGAL_CONTACT_EMAIL } from "@/components/legal/legal-page";

/**
 * What a student sees when a page fails, instead of React's internal message
 * ("Minified React error #441…" is a server error whose text production
 * hides). A plain explanation, an offline hint, a retry that really reloads
 * the page's data, and a short code (Next's error digest) the team can find
 * in the server logs: `docker compose logs app | grep <code>`.
 */
export function ErrorScreen({ error, reset, inline = false }: { error: Error & { digest?: string }; reset: () => void; inline?: boolean }) {
  const t = useTranslations("errorPage");
  const router = useRouter();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    console.error(error);
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
  }, [error]);

  // reset() alone re-renders with the same failed server data; refresh first.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  const code = error.digest ?? null;
  const mail = `mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(`Abugida error${code ? ` ${code}` : ""}`)}`;

  return (
    <div
      className={
        inline
          ? "flex min-h-[60vh] flex-col items-center justify-center gap-5 p-6 text-center"
          : "flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-6 text-center"
      }
      role="alert"
      data-testid="error-screen"
    >
      {offline ? (
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-warning/10 text-warning">
          <WifiOff className="h-10 w-10" />
        </span>
      ) : (
        <GuideMascot expression="concerned" size={110} />
      )}
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-bold text-text-primary">{offline ? t("offlineTitle") : t("title")}</h1>
        <p className="text-sm text-text-secondary">{offline ? t("offlineBody") : t("body")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
          data-testid="error-retry"
        >
          <RotateCcw className="h-4 w-4" /> {t("retry")}
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-text-secondary hover:bg-border/40"
        >
          <Home className="h-4 w-4" /> {t("home")}
        </Link>
        {!offline && (
          <a
            href={mail}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-text-secondary hover:bg-border/40"
          >
            <Mail className="h-4 w-4" /> {t("report")}
          </a>
        )}
      </div>
      {code && !offline && (
        <p className="text-xs text-text-muted" data-testid="error-code">
          {t("code")} <span className="font-mono">{code}</span>
        </p>
      )}
      {process.env.NODE_ENV !== "production" && error.message && (
        <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg bg-error/5 p-3 text-left text-xs text-error">{error.message}</pre>
      )}
    </div>
  );
}
