"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Inbox, Mail, RotateCcw, Send, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn, formatDate } from "@/lib/utils";

type Status = "open" | "answered" | "closed";
type Filter = Status | "all";

interface Msg {
  id: string;
  topic: string;
  body: string;
  status: Status;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    username: string | null;
    email: string | null;
    role: string;
    grade: number | null;
    school: { name: string } | null;
  };
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Waiting" },
  { value: "answered", label: "Answered" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const TOPICS: Record<string, string> = {
  payment: "Payment",
  account: "Account",
  bug: "Something broken",
  content: "Questions / textbooks",
  idea: "Idea",
  other: "Other",
};

const ROLES: Record<string, string> = {
  STUDENT: "Student",
  TEACHER: "Teacher (1-8)",
  SECONDARY_TEACHER: "Teacher (9-12)",
  SCHOOL_ADMIN: "School admin",
};

/** Admin → Messages: what users sent from "Contact us"; answer, close or reopen. */
export default function AdminMessagesPage() {
  const [filter, setFilter] = useState<Filter>("open");
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [counts, setCounts] = useState<Record<Status, number>>({ open: 0, answered: 0, closed: 0 });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (f: Filter) => {
    setMessages(null);
    try {
      const res = await fetch(`/api/admin/support-messages?status=${f}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setMessages(d.messages);
      setCounts(d.counts);
    } catch (e) {
      setMessages([]);
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't load messages");
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const patch = async (id: string, body: { reply?: string; status?: Status }) => {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/support-messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save");
      toast.success(body.reply ? "Reply sent — they'll get a notification" : "Updated");
      setDrafts((x) => ({ ...x, [id]: "" }));
      await load(filter);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5" data-testid="admin-messages">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Inbox className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Messages</h1>
          <p className="text-sm text-text-secondary">
            What students, teachers and school admins sent from &ldquo;Contact us&rdquo;. Your reply shows on their contact
            page and arrives as a notification.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold",
              filter === f.value ? "border-primary bg-primary text-white" : "border-border text-text-secondary hover:bg-border/40",
            )}
            data-testid={`messages-filter-${f.value}`}
          >
            {f.label}
            {f.value !== "all" && (
              <span className={cn("rounded-full px-1.5 text-xs", filter === f.value ? "bg-white/25" : "bg-border")}>
                {counts[f.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {messages === null ? (
        <div className="flex justify-center py-10">
          <Spinner size="lg" className="text-primary" />
        </div>
      ) : messages.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
          No messages here.
        </p>
      ) : (
        messages.map((m) => (
          <Card key={m.id} data-testid="admin-message">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-semibold text-text-primary">{m.user.name}</span>
                {m.user.username && <span className="text-text-muted">@{m.user.username}</span>}
                <span className="rounded-full bg-border px-2 py-0.5 text-xs text-text-secondary">
                  {ROLES[m.user.role] ?? m.user.role}
                  {m.user.grade ? ` · Grade ${m.user.grade}` : ""}
                </span>
                {m.user.school && <span className="text-xs text-text-muted">{m.user.school.name}</span>}
                <span className="ml-auto text-xs text-text-muted">{formatDate(m.createdAt)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{TOPICS[m.topic] ?? m.topic}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
                    m.status === "answered" ? "bg-success/10 text-success" : m.status === "closed" ? "bg-border text-text-secondary" : "bg-warning/10 text-warning",
                  )}
                >
                  {m.status === "answered" ? <CheckCircle2 className="h-3.5 w-3.5" /> : m.status === "closed" ? <XCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  {m.status === "open" ? "Waiting" : m.status === "answered" ? "Answered" : "Closed"}
                </span>
                {m.user.email && (
                  <a href={`mailto:${m.user.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    <Mail className="h-3.5 w-3.5" /> {m.user.email}
                  </a>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words rounded-xl bg-background px-3 py-2 text-sm text-text-primary">{m.body}</p>
              {m.reply && (
                <div className="rounded-xl border-l-4 border-primary bg-primary/5 px-3 py-2">
                  <p className="text-xs font-bold text-primary">
                    Your reply{m.repliedAt ? <span className="font-normal text-text-muted"> · {formatDate(m.repliedAt)}</span> : null}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">{m.reply}</p>
                </div>
              )}
              <textarea
                value={drafts[m.id] ?? ""}
                onChange={(e) => setDrafts((x) => ({ ...x, [m.id]: e.target.value.slice(0, 2000) }))}
                rows={2}
                placeholder={m.reply ? "Send another reply (replaces the one above)…" : "Write a reply…"}
                className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                data-testid="admin-reply"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => patch(m.id, { reply: drafts[m.id] ?? "" })}
                  disabled={busy === m.id || !(drafts[m.id] ?? "").trim()}
                  isLoading={busy === m.id}
                  data-testid="admin-reply-send"
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Send reply
                </Button>
                {m.status !== "closed" ? (
                  <Button size="sm" variant="ghost" onClick={() => patch(m.id, { status: "closed" })} disabled={busy === m.id}>
                    <XCircle className="mr-1.5 h-3.5 w-3.5" /> Close
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => patch(m.id, { status: "open" })} disabled={busy === m.id}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reopen
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
