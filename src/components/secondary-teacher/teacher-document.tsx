"use client";

import { Lock } from "lucide-react";
import { MarkdownView } from "@/components/ui/markdown-view";
import { splitAnswerKey } from "@/lib/answer-key";

/**
 * An AI-written document as its teacher sees it: the part students get, then
 * the answer key set apart and labelled as teacher-only.
 *
 * The same split runs on the server when the document is given to a class,
 * so what is shown here under "Answer key" is exactly what students will not
 * receive. Showing the raw text instead printed the machine fence
 * ("<<<ANSWER_KEY>>>") in the middle of the page.
 */
export function TeacherDocument({ markdown }: { markdown: string }) {
  const { body, answerKey } = splitAnswerKey(markdown);
  return (
    <div className="space-y-4">
      <MarkdownView markdown={body} />
      {answerKey && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <Lock className="h-4 w-4" /> Answer key — only you see this
          </h3>
          <p className="print-hide mb-2 text-xs text-amber-800">
            Kept back automatically when you give this to a class.
          </p>
          <MarkdownView markdown={answerKey} />
        </section>
      )}
    </div>
  );
}
