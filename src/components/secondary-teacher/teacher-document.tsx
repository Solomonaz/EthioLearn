"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { MarkdownView } from "@/components/ui/markdown-view";
import { splitAnswerKey } from "@/lib/answer-key";
import { cn } from "@/lib/utils";

/**
 * An AI-written document as its teacher sees it: the part students get, then
 * the answer key set apart and labelled as teacher-only.
 *
 * The same split runs on the server when the document is given to a class,
 * so what is shown here under "Answer key" is exactly what students will not
 * receive. Showing the raw text instead printed the machine fence
 * ("<<<ANSWER_KEY>>>") in the middle of the page.
 *
 * The key starts collapsed, as on the activity page, so the document reads
 * as the students will see it. It is only hidden on screen — Print still
 * includes it, since printing is how a teacher takes the answers to class.
 */
export function TeacherDocument({ markdown }: { markdown: string }) {
  const { body, answerKey } = splitAnswerKey(markdown);
  const [showKey, setShowKey] = useState(false);
  return (
    <div className="space-y-4">
      <MarkdownView markdown={body} />
      {answerKey && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            aria-expanded={showKey}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
              <Lock className="h-4 w-4" /> Answer key — only you see this
            </span>
            <span className="print-hide flex items-center gap-1 text-xs font-semibold text-amber-800">
              {showKey ? "Hide" : "Show"}
              {showKey ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </button>
          <div className={cn("mt-2", !showKey && "hidden print:block")}>
            <p className="print-hide mb-2 text-xs text-amber-800">
              Kept back automatically when you give this to a class.
            </p>
            <MarkdownView markdown={answerKey} />
          </div>
        </section>
      )}
    </div>
  );
}
