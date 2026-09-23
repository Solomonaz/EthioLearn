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
  const [fetchingData, setFetchingData] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

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

  const handleSend = async () => {
    if (!input.trim() || !selectedChapter || isLoading) return;

    const userMessage = input.trim();
    const newMessages: Message[] = [
      ...messages,
      { role: "user", parts: [{ text: userMessage }] },
    ];

    setMessages(newMessages);
    setInput("");
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

      if (!res.ok) throw new Error("Failed to get tutor response");

      const data = await res.json();
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

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-6 lg:flex-row">
      {/* Sidebar: Selection */}
      <div className="w-full lg:w-80 lg:shrink-0">
        <Card className="h-full border-border bg-surface/50 backdrop-blur-sm">
          <CardContent className="flex flex-col gap-6 p-6">
            <div className="flex items-center gap-2 text-primary">
              <BookOpen className="h-5 w-5" />
              <h2 className="font-bold tracking-tight">Study Context</h2>
            </div>

            {/* Textbook Select */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-text-muted">
                Select Textbook
              </label>
              <select
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                value={selectedTextbook?.id || ""}
                onChange={(e) => {
                  const tb = textbooks.find((t) => t.id === e.target.value);
                  setSelectedTextbook(tb || null);
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

            {/* Chapter Select */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-text-muted">
                Select Chapter
              </label>
              <select
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 transition-all"
                disabled={!selectedTextbook}
                value={selectedChapter?.id || ""}
                onChange={(e) => {
                  const ch = chapters.find((c) => c.id === e.target.value);
                  setSelectedChapter(ch || null);
                  setMessages([]);
                }}
              >
                <option value="">Choose a chapter...</option>
                {chapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    Ch {ch.chapterNumber}: {ch.title}
                  </option>
                ))}
              </select>
            </div>

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

      {/* Main: Chat Area */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface/30 backdrop-blur-md shadow-xl">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface/80 p-4 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-sm font-bold">AI Tutor</h1>
              <p className="text-[10px] text-green-500 font-medium flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
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
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Messages List */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-full bg-primary/5 p-6">
                <MessageSquare className="h-12 w-12 text-primary/20" />
              </div>
              <div className="max-w-xs space-y-2">
                <h3 className="font-bold text-lg">Start Learning</h3>
                <p className="text-sm text-text-muted leading-relaxed">
                  Select a textbook and chapter on the left to begin your
                  personalized tutoring session.
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white",
                      msg.role === "user" ? "bg-primary" : "bg-text-muted"
                    )}
                  >
                    {msg.role === "user" ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>
                  <div
                    className={cn(
                      "max-w-[85%] lg:max-w-[70%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm overflow-x-auto",
                      msg.role === "user"
                        ? "bg-primary text-white rounded-tr-none"
                        : "bg-surface border border-border text-text-primary rounded-tl-none prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed"
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
                      msg.parts[0].text
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-4 animate-pulse">
                  <div className="bg-text-muted flex h-8 w-8 items-center justify-center rounded-full">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="bg-surface border border-border rounded-2xl rounded-tl-none px-6 py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Chat Input */}
        <div className="border-t border-border bg-surface/80 p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="relative flex items-center gap-2"
          >
            <input
              className="flex-1 rounded-xl border border-border bg-surface/50 px-5 py-4 text-sm outline-none transition-all placeholder:text-text-muted focus:ring-2 focus:ring-primary/20 pr-14 disabled:opacity-50"
              placeholder={
                selectedChapter
                  ? "Ask your tutor anything..."
                  : "Please select a chapter first..."
              }
              disabled={!selectedChapter || isLoading}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              className="absolute right-2 top-1.5 h-10 w-10 rounded-lg shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:grayscale"
              disabled={!selectedChapter || !input.trim() || isLoading}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <p className="mt-3 text-[10px] text-center text-text-muted">
            The tutor follows the official curriculum and focuses on the
            selected chapter only.
          </p>
        </div>
      </div>
    </div>
  );
}
