"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Clock, Mail, MessageCircle, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { LEGAL_CONTACT_EMAIL } from "@/components/legal/legal-page";
import { isSupportTopic, SUPPORT_MAX_CHARS, SUPPORT_MIN_CHARS, SUPPORT_TOPICS, type SupportTopic } from "@/lib/support";

interface Msg {
  id: string;
  topic: SupportTopic;
  body: string;
  status: "open" | "answered" | "closed";
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

/** Optional Telegram handle for support (without @), shown as a quick link. */
const TELEGRAM = (process.env.NEXT_PUBLIC_SUPPORT_TELEGRAM ?? "").replace(/^@/, "").trim();

/**
 * "Contact us" — the same page in every area (student, grades 1-8 play,
 * teachers, school admins): write to the Abugida team, see your earlier
 * messages and the team's replies. Answers arrive as a notification too.
 */
function ContactPanelInner() {
  const t = useTranslations("contact");
  const locale = useLocale();
  const params = useSearchParams();
  const preset = params.get("topic");
  const [topic, setTopic] = useState<SupportTopic | null>(isSupportTopic(preset) ? preset : null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/support-messages");
      const d = await res.json();
      setMessages(res.ok ? d.messages : []);
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic) return setError(t("pickTopic"));
    if (body.trim().length < SUPPORT_MIN_CHARS) return setError(t("tooShort"));
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/support-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          d.code === "RATE_LIMITED" ? t("rateLimited") : d.code === "DAILY_LIMIT" ? t("dailyLimit") : d.code === "TOO_SHORT" ? t("tooShort") : t("sendFailed"),
        );
        return;
      }
      setMessages((m) => [d.message as Msg, ...(m ?? [])]);
      setBody("");
      setTopic(null);
      toast.success(t("sent"));
    } catch {
      setError(t("sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "am" ? "am-ET" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="contact-page">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <MessageCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text-primary sm:text-2xl">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-text-secondary">{t("intro")}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={send} className="space-y-4" data-testid="contact-form">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-text-primary">{t("topicLabel")}</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("topicLabel")}>
                {SUPPORT_TOPICS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={topic === k}
                    onClick={() => {
                      setTopic(k);
                      setError(null);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      topic === k
                        ? "border-primary bg-primary text-white"
                        : "border-border text-text-secondary hover:border-primary/50 hover:bg-primary/5",
                    )}
                    data-testid={`contact-topic-${k}`}
                  >
                    {t(`topics.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-text-primary">{t("messageLabel")}</span>
              <textarea
                value={body}
                onChange={(e) => {
                  setBody(e.target.value.slice(0, SUPPORT_MAX_CHARS));
                  setError(null);
                }}
                rows={5}
                maxLength={SUPPORT_MAX_CHARS}
                placeholder={t("placeholder")}
                className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-base text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:text-sm"
                data-testid="contact-body"
              />
              <span className="flex justify-between text-xs text-text-muted">
                <span>{t("privacyNote")}</span>
                <span>
                  {body.length}/{SUPPORT_MAX_CHARS}
                </span>
              </span>
            </label>
            {error && (
              <p className="text-sm text-error" role="alert" data-testid="contact-error">
                {error}
              </p>
            )}
            <Button type="submit" isLoading={sending} disabled={sending} data-testid="contact-send">
              <Send className="mr-1.5 h-4 w-4" /> {t("send")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-secondary">
        <span>{t("orReach")}</span>
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
          <Mail className="h-4 w-4" /> {LEGAL_CONTACT_EMAIL}
        </a>
        {TELEGRAM && (
          <a
            href={`https://t.me/${encodeURIComponent(TELEGRAM)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <Send className="h-4 w-4" /> @{TELEGRAM}
          </a>
        )}
      </div>

      <section className="space-y-3" data-testid="contact-history">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">{t("yourMessages")}</h2>
        {messages === null ? (
          <div className="flex justify-center py-6">
            <Spinner size="md" className="text-primary" />
          </div>
        ) : messages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">{t("noMessages")}</p>
        ) : (
          messages.map((m) => (
            <Card key={m.id} data-testid="contact-message">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{t(`topics.${m.topic}`)}</span>
                  <span className="text-text-muted">{date(m.createdAt)}</span>
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
                      m.status === "answered" ? "bg-success/10 text-success" : m.status === "closed" ? "bg-border text-text-secondary" : "bg-warning/10 text-warning",
                    )}
                    data-testid="contact-status"
                  >
                    {m.status === "answered" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                    {t(`status.${m.status}`)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{m.body}</p>
                {m.reply && (
                  <div className="rounded-xl border-l-4 border-primary bg-primary/5 px-3 py-2" data-testid="contact-reply">
                    <p className="text-xs font-bold text-primary">
                      {t("teamReply")}
                      {m.repliedAt ? <span className="font-normal text-text-muted"> · {date(m.repliedAt)}</span> : null}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">{m.reply}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

export function ContactPanel() {
  return (
    <Suspense fallback={null}>
      <ContactPanelInner />
    </Suspense>
  );
}
