"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Download, Printer, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { GiveToClassDialog } from "./give-to-class-dialog";
import { markdownToDocxBlob, safeFileBase } from "@/lib/export-doc";

/**
 * What a teacher can do with a piece of AI-generated material: keep it, take it
 * away as a file, put it on paper, or give it to a class.
 *
 * Shared by the assistant (fresh output) and the saved library, so the two
 * offer the same actions. `onSaved` is omitted for something already saved,
 * which is what hides the Save button there.
 */

export function ResourceActions({
  title,
  markdown,
  task,
  subject,
  grade,
  chapterTitle,
  onSaved,
}: {
  title: string;
  markdown: string;
  task?: string;
  subject?: string | null;
  grade?: number | null;
  chapterTitle?: string | null;
  /** Provided only when this is unsaved; omitting it hides Save. */
  onSaved?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [giving, setGiving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the download menu on an outside click, the way a menu should behave.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/secondary-teacher/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, title, body: markdown, subject, grade, chapterTitle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save that");
      setSaved(true);
      toast.success("Saved to your materials.");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  /** Hand a Blob to the browser as a download. */
  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadWord() {
    setMenuOpen(false);
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await markdownToDocxBlob(title, markdown);
      saveBlob(blob, `${safeFileBase(title)}.docx`);
    } catch {
      toast.error("Could not build the Word file — try Markdown instead.");
    } finally {
      setExporting(false);
    }
  }

  function downloadMarkdown() {
    setMenuOpen(false);
    try {
      // The title is kept as an H1 so the file stands on its own.
      const blob = new Blob([`# ${title}\n\n${markdown}\n`], {
        type: "text/markdown;charset=utf-8",
      });
      saveBlob(blob, `${safeFileBase(title)}.md`);
    } catch {
      toast.error("Could not download — try Copy instead.");
    }
  }

  /**
   * PDF goes through the browser's own print dialog ("Save as PDF").
   *
   * That is deliberate, not a shortcut: it keeps the typeset KaTeX maths and
   * real selectable text. A client-side PDF library would either rasterise the
   * page (fuzzy text, huge files) or drop the maths entirely — which is the
   * exact problem we just finished fixing.
   */
  function downloadPdf() {
    setMenuOpen(false);
    toast.info("Choose “Save as PDF” as the destination.");
    // Let the toast paint before the modal print dialog blocks the page.
    setTimeout(() => window.print(), 350);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Copied.");
    } catch {
      toast.error("Could not copy — select the text and copy manually.");
    }
  }

  return (
    <>
      <div className="print-hide flex flex-wrap items-center gap-2">
        {onSaved && (
          <Button type="button" variant="outline" size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <Spinner size="sm" />
            ) : saved ? (
              <>
                <Check className="mr-1.5 h-4 w-4" /> Saved
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-4 w-4" /> Save
              </>
            )}
          </Button>
        )}
        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={exporting}
          >
            {exporting ? (
              <Spinner size="sm" />
            ) : (
              <>
                <Download className="mr-1.5 h-4 w-4" /> Download
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </>
            )}
          </Button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
              <MenuItem onClick={downloadWord} label="Word (.docx)" hint="Editable document" />
              <MenuItem onClick={downloadPdf} label="PDF" hint="Keeps typeset maths" />
              <MenuItem
                onClick={downloadMarkdown}
                label="Markdown (.md)"
                hint="Plain text source"
              />
            </div>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> Print
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          <Copy className="mr-1.5 h-4 w-4" /> Copy
        </Button>
        <Button type="button" size="sm" onClick={() => setGiving(true)}>
          <Send className="mr-1.5 h-4 w-4" /> Give to class
        </Button>
      </div>

      {giving && (
        <GiveToClassDialog
          title={title}
          markdown={markdown}
          onClose={() => setGiving(false)}
        />
      )}
    </>
  );
}

function MenuItem({
  onClick,
  label,
  hint,
}: {
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left transition hover:bg-border/40"
    >
      <span className="block text-sm font-semibold text-text-primary">{label}</span>
      <span className="block text-[11px] text-text-muted">{hint}</span>
    </button>
  );
}
