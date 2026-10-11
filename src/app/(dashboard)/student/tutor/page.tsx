"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSession } from "next-auth/react";
import {
  MessageSquare,
  Send,
  BookOpen,
  Sparkles,
  Bot,
  User,
  Loader2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useNotesContext } from "@/lib/notes-context";

interface Chapter {
  id: string;
  title: string;
  chapterNumber: number;
}

interface Textbook {
  id: string;
  title: string;
  subject: string;
  grade: number;
}

/** One-tap openers shown before the first message. */
const STARTERS = [
  "Summarize this chapter",
  "Explain the key terms",
  "Quiz me with 3 questions",
  "What should I focus on for the exam?",
];

interface Message {
  role: "user" | "model";
  parts: { text: string }[];
}

export default function TutorPage() {
  const { data: session } = useSession();
  const ent = useEntitlements();

  // Selection state
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedTextbook, setSelectedTextbook] = useState<Textbook | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  // New study notes taken here are tagged with the chapter being studied.
  useNotesContext(selectedChapter && selectedTextbook ? `${selectedChapter.title} · ${selectedTextbook.subject}` : null);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // Tutor messages left today (daily cap); null = unknown or no cap.
  const [remainingToday, setRemainingToday] = useState<number | null>(null);
  const [fetchingData, setFetchingData] = useState(true);

  // Phones: whether the book/chapter pickers are unfolded.
  const [pickerOpen, setPickerOpen] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initial load: fetch the textbooks in the student's study scope — their own
  // grade plus the lower grades of the same exam cycle (see lib/grade-scope).
  // Each card shows its grade, so a grade 12 can pick a grade 9 book to revise.
  useEffect(() => {
    if (!session?.user?.grade) return;

    async function init() {
      try {
        const res = await fetch(`/api/textbooks`);
        const data = await res.json();
        setTextbooks(data.textbooks || []);
      } catch (err) {
        console.error("Failed to load textbooks", err);
      } finally {
        setFetchingData(false);
      }
    }
    init();
  }, [session]);

  // Fetch chapters when textbook changes
  useEffect(() => {
    if (!selectedTextbook) {
      setChapters([]);
      setSelectedChapter(null);
      return;
    }

    async function fetchChapters() {
      try {
        const res = await fetch(`/api/textbooks/${selectedTextbook?.id}/chapters`);
        const data = await res.json();
        setChapters(data.chapters || []);
      } catch (err) {
        console.error("Failed to load chapters", err);
      }
    }
    fetchChapters();
  }, [selectedTextbook]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || !selectedChapter || isLoading) return;

    const userMessage = text.trim();
    const newMessages: Message[] = [
      ...messages,
      { role: "user", parts: [{ text: userMessage }] },
    ];

    setMessages(newMessages);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);

    try {
      const res = await fetch("/api/ai/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: selectedChapter.id,
          message: userMessage,
          history: messages,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (typeof data?.remainingToday === "number") setRemainingToday(data.remainingToday);
        // Limits and plan messages are written for the student; show them as-is.
        if (typeof data?.error === "string" && res.status !== 500) {
          setMessages([...newMessages, { role: "model", parts: [{ text: data.error }] }]);
          return;
        }
        throw new Error("Failed to get tutor response");
      }

      if (typeof data.remainingToday === "number") setRemainingToday(data.remainingToday);
      setMessages([
        ...newMessages,
        { role: "model", parts: [{ text: data.response }] },
      ]);
    } catch (err) {
      console.error(err);
      setMessages([
        ...newMessages,
        {
          role: "model",
          parts: [
            {
              text: "❌ I'm sorry, I'm having trouble connecting right now. Please try again in a moment.",
            },
          ],
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear this conversation?")) {
      setMessages([]);
    }
  };

  // Plan gating — the AI Tutor requires an AI-enabled plan.
  if (!ent.loading && !(ent.ai && ent.aiFeatures.aiTutor)) {
    return <UpgradeNotice feature="AI Tutor" planName={ent.planName} />;
  }

  if (fetchingData) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4">
        <Spinner size="lg" />
        <p className="text-text-muted animate-pulse">Initializing your AI Tutor...</p>
      </div>
    );
  }

  const canChat = !!selectedChapter && remainingToday !== 0;

  const pickers = (
    <>
      <div className="space-y-1.5">
        <label htmlFor="tutor-book" className="text-xs font-semibold uppercase text-text-muted">
          Textbook
        </label>
        <select
          id="tutor-book"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none transition-all focus:ring-2 focus:ring-primary/20 lg:px-4 lg:py-3 lg:text-sm"
          value={selectedTextbook?.id || ""}
          onChange={(e) => {
            const tb = textbooks.find((t) => t.id === e.target.value);
            setSelectedTextbook(tb || null);
            setSelectedChapter(null);
            setMessages([]);
          }}
        >
          <option value="">Choose a book...</option>
          {textbooks.map((tb) => (
            <option key={tb.id} value={tb.id}>
              {tb.subject} Grade {tb.grade}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="tutor-chapter" className="text-xs font-semibold uppercase text-text-muted">
          Chapter
        </label>
        <select
          id="tutor-chapter"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none transition-all focus:ring-2 focus:ring-primary/20 disabled:opacity-50 lg:px-4 lg:py-3 lg:text-sm"
          disabled={!selectedTextbook}
          value={selectedChapter?.id || ""}
          onChange={(e) => {
            const ch = chapters.find((c) => c.id === e.target.value);
            setSelectedChapter(ch || null);
            setMessages([]);
            if (ch) setPickerOpen(false);
          }}
        >
          <option value="">{selectedTextbook ? "Choose a chapter..." : "Pick a book first"}</option>
          {chapters.map((ch) => (
            <option key={ch.id} value={ch.id}>
              Ch {ch.chapterNumber}: {ch.title}
            </option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    // Fills the screen between the top bar and, on phones, the bottom tab
    // bar (header 4rem + page padding + the bar's reserved space), so the
    // chat scrolls inside itself and the input never sits under the tabs.
    <div className="flex h-[calc(100dvh-11rem)] flex-col gap-3 sm:h-[calc(100dvh-12rem)] md:h-[calc(100dvh-7rem)] lg:h-[calc(100dvh-8rem)] lg:flex-row lg:gap-6">
      {/* Phones: one compact bar. Once a chapter is chosen it folds into a
          summary line, leaving the screen to the conversation. */}
      <div className="shrink-0 rounded-2xl border border-border bg-surface p-3 lg:hidden">
        {selectedChapter && !pickerOpen ? (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-text-muted">
                {selectedTextbook?.subject} · Grade {selectedTextbook?.grade}
              </p>
              <p className="truncate text-sm font-semibold text-text-primary">
                Ch {selectedChapter.chapterNumber}: {selectedChapter.title}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              Change
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{pickers}</div>
        )}
      </div>

      {/* Desktop: the study context sits beside the chat. */}
      <div className="hidden lg:block lg:w-80 lg:shrink-0">
        <Card className="h-full border-border bg-surface/50 backdrop-blur-sm">
          <CardContent className="flex h-full flex-col gap-6 p-6">
            <div className="flex items-center gap-2 text-primary">
              <BookOpen className="h-5 w-5" />
              <h2 className="font-bold tracking-tight">Study Context</h2>
            </div>
            {pickers}
            <div className="mt-auto space-y-4 rounded-xl bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm font-bold">Pro Tip</span>
              </div>
              <p className="text-xs leading-relaxed text-text-secondary">
                Ask follow-up questions in the chat — the tutor stays focused
                on your selected chapter!
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chat */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:bg-surface/30 lg:shadow-xl lg:backdrop-blur-md">
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface/80 px-3 py-2.5 lg:p-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary lg:h-10 lg:w-10">
              <Bot className="h-5 w-5 lg:h-6 lg:w-6" />
            </div>
            <div>
              <h1 className="text-sm font-bold">AI Tutor</h1>
              <p className="flex items-center gap-1 text-[10px] font-medium text-green-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                Always ready to help
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-text-muted hover:text-error"
            onClick={clearChat}
            disabled={messages.length === 0}
            aria-label="Clear conversation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto scroll-smooth p-3 sm:p-4 lg:space-y-6 lg:p-6"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-full bg-primary/5 p-4 lg:p-6">
                <MessageSquare className="h-8 w-8 text-primary/30 lg:h-12 lg:w-12" />
              </div>
              {selectedChapter ? (
                <div className="w-full max-w-sm space-y-3">
                  <h3 className="font-bold">Ask about this chapter</h3>
                  <div className="flex flex-wrap justify-center gap-2">
                    {STARTERS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => handleSend(q)}
                        disabled={!canChat || isLoading}
                        className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-xs space-y-2">
                  <h3 className="text-lg font-bold">Start Learning</h3>
                  <p className="text-sm leading-relaxed text-text-muted">
                    <span className="lg:hidden">Choose a textbook and chapter above</span>
                    <span className="hidden lg:inline">Select a textbook and chapter on the left</span>{" "}
                    to begin your personalized tutoring session.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300 lg:gap-4",
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div
                    className={cn(
                      "hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-white sm:flex",
                      msg.role === "user" ? "bg-primary" : "bg-text-muted"
                    )}
                  >
                    {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div
                    className={cn(
                      "overflow-x-auto rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm lg:px-5 lg:py-3",
                      msg.role === "user"
                        ? "max-w-[85%] rounded-tr-none bg-primary text-white lg:max-w-[70%]"
                        : "prose prose-sm max-w-[92%] rounded-tl-none border border-border bg-surface text-text-primary dark:prose-invert prose-p:leading-relaxed sm:max-w-[85%] lg:max-w-[70%]"
                    )}
                  >
                    {msg.role === "model" ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        allowedElements={[
                          "p","strong","em","b","i","code","pre","ul","ol","li",
                          "h1","h2","h3","h4","h5","h6","blockquote","br","hr",
                          "a","table","thead","tbody","tr","th","td",
                        ]}
                        unwrapDisallowed
                        components={{
                          a: ({ href, children }) => {
                            const safeHref = /^(https?:|\/|#)/.test(href ?? "") ? href : "#";
                            return <a href={safeHref} target="_blank" rel="noopener noreferrer">{children}</a>;
                          },
                        }}
                      >
                        {msg.parts[0].text}
                      </ReactMarkdown>
                    ) : (
                      <span className="whitespace-pre-wrap break-words">{msg.parts[0].text}</span>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-2 lg:gap-4">
                  <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-text-muted sm:flex">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl rounded-tl-none border border-border bg-surface px-4 py-3 text-xs text-text-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Thinking…
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-surface/80 p-2.5 sm:p-4 lg:p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              rows={1}
              // 16px text: smaller makes iOS Safari zoom the page on focus.
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-surface/50 px-4 py-2.5 text-base outline-none transition-all placeholder:text-text-muted focus:ring-2 focus:ring-primary/20 disabled:opacity-50 lg:py-3 lg:text-sm"
              placeholder={selectedChapter ? "Ask your tutor anything..." : "Choose a chapter first..."}
              disabled={!canChat || isLoading}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                // Enter sends on a keyboard; Shift+Enter adds a line.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button
              type="submit"
              className="h-11 w-11 shrink-0 rounded-xl p-0 shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:grayscale"
              disabled={!canChat || !input.trim() || isLoading}
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <p className="mt-2 text-center text-[10px] text-text-muted lg:mt-3">
            <span className="hidden sm:inline">
              The tutor follows the official curriculum and focuses on the selected chapter only.
            </span>
            {remainingToday !== null &&
              (remainingToday === 0
                ? " No messages left today. They renew at midnight."
                : ` ${remainingToday} message${remainingToday === 1 ? "" : "s"} left today.`)}
          </p>
        </div>
      </div>
    </div>
  );
}
