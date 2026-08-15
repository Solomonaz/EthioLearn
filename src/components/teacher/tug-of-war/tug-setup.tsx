"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Calculator, FolderOpen, PencilLine, Sparkles, Plus, Trash2, Check, Play } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  questionsFromStored,
  TUG,
  type TugConfig,
  type TugMatch,
  type TugQuestion,
  type TugSource,
  type StoredMcq,
} from "@/lib/games/tug-of-war";

interface SavedSet {
  id: string;
  title: string;
  subject: string;
  grade: number;
  questionCount: number;
}

interface ManualQ {
  text: string;
  options: string[];
  correctIndex: number;
}

const SOURCE_META: { key: TugSource; icon: typeof Calculator; labelKey: string }[] = [
  { key: "MATH", icon: Calculator, labelKey: "mtSourceMath" },
  { key: "SET", icon: FolderOpen, labelKey: "mtSourceSet" },
  { key: "MANUAL", icon: PencilLine, labelKey: "mtSourceManual" },
  { key: "AI", icon: Sparkles, labelKey: "mtSourceAI" },
];

export function TugSetup({
  onStart,
  initialSetId,
}: {
  onStart: (match: TugMatch) => void;
  /** When present, preselect the "Teacher's Questions" source and this set. */
  initialSetId?: string;
}) {
  const t = useTranslations("games");

  const [source, setSource] = useState<TugSource>(initialSetId ? "SET" : "MATH");
  const [team1, setTeam1] = useState(t("team1"));
  const [team2, setTeam2] = useState(t("team2"));
  // Custom, teacher-set values. Match time is entered in minutes (0 = no limit);
  // match length is the number of pulls needed to win.
  const [matchMinutes, setMatchMinutes] = useState<number>(2);
  const [target, setTarget] = useState<number>(TUG.DEFAULT_TARGET);

  // SET
  const [sets, setSets] = useState<SavedSet[] | null>(null);
  const [selectedSet, setSelectedSet] = useState<string>(initialSetId ?? "");

  // MANUAL
  const [manual, setManual] = useState<ManualQ[]>([]);
  const [draft, setDraft] = useState<ManualQ>({ text: "", options: ["", ""], correctIndex: 0 });

  // AI
  const [aiSubject, setAiSubject] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiGrade, setAiGrade] = useState(3);
  const [aiLang, setAiLang] = useState<"en" | "am">("en");
  const [aiRows, setAiRows] = useState<StoredMcq[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    fetch("/api/teacher/games")
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d) => setSets(d.games ?? []))
      .catch(() => setSets([]));
  }, []);

  // ── Manual question builder ───────────────────────────────
  const addManual = () => {
    const text = draft.text.trim();
    const opts = draft.options.map((o) => o.trim()).filter(Boolean);
    if (!text || opts.length < 2 || draft.correctIndex >= opts.length || !draft.options[draft.correctIndex]?.trim()) {
      toast.error(t("mtManInvalid"));
      return;
    }
    setManual((m) => [...m, { text, options: opts, correctIndex: draft.correctIndex }]);
    setDraft({ text: "", options: ["", ""], correctIndex: 0 });
  };

  const setDraftOption = (i: number, value: string) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? value : o)) }));

  // ── AI generation ─────────────────────────────────────────
  const generateAi = async () => {
    if (!aiTopic.trim()) {
      toast.error(t("mtAiTopicPh"));
      return;
    }
    setAiLoading(true);
    setAiRows(null);
    try {
      const res = await fetch("/api/teacher/games/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: aiSubject || "General",
          topic: aiTopic,
          grade: aiGrade,
          language: aiLang,
          count: 8,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t("mtGenError"));
      const rows = (data?.questions ?? []) as StoredMcq[];
      if (rows.length === 0) throw new Error(t("mtGenError"));
      setAiRows(rows);
      toast.success(t("mtReady", { n: rows.length }));
    } catch (err) {
      // Surface the real reason (e.g. "AI generation is turned off").
      toast.error(err instanceof Error ? err.message : t("mtGenError"));
    } finally {
      setAiLoading(false);
    }
  };

  // ── Start ─────────────────────────────────────────────────
  // Non-math sources are drawn from a finite pool (options mode); math is
  // generated on demand (keypad mode) and needs no pre-built deck.
  const buildDeck = async (): Promise<TugQuestion[] | null> => {
    if (source === "MANUAL") {
      if (manual.length < 2) {
        toast.error(t("mtManNeed"));
        return null;
      }
      return manual.map((q, i) => ({ id: `man-${i}`, ...q }));
    }
    if (source === "AI") {
      const deck = questionsFromStored(aiRows ?? [], "ai");
      if (deck.length < 2) {
        toast.error(t("mtGenerateFirst"));
        return null;
      }
      return deck;
    }
    // SET
    if (!selectedSet) {
      toast.error(t("mtPickSet"));
      return null;
    }
    const res = await fetch(`/api/teacher/games/${selectedSet}`);
    if (!res.ok) {
      toast.error(t("mtGenError"));
      return null;
    }
    const data = await res.json();
    const deck = questionsFromStored((data.game?.questions ?? []) as StoredMcq[], "set");
    if (deck.length < 2) {
      toast.error(t("mtManNeed"));
      return null;
    }
    return deck;
  };

  const start = async () => {
    const config: TugConfig = {
      team1Name: team1.trim() || t("team1"),
      team2Name: team2.trim() || t("team2"),
      matchSeconds: Math.max(0, Math.round((Number(matchMinutes) || 0) * 60)),
      target: Math.max(2, Math.round(Number(target) || TUG.DEFAULT_TARGET)),
    };
    if (source === "MATH") {
      onStart({ config, mode: "keypad", band: "mix" });
      return;
    }
    const deck = await buildDeck();
    if (!deck) return;
    onStart({ config, mode: "options", deck });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{t("tug")}</h1>
        <p className="mt-1 text-text-secondary">{t("mtSubtitle")}</p>
      </div>

      {/* Source picker */}
      <div>
        <p className="mb-2 text-sm font-semibold text-text-primary">{t("mtSource")}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SOURCE_META.map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              onClick={() => setSource(key)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 text-sm font-semibold transition-colors",
                source === key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-text-secondary hover:border-primary/40",
              )}
            >
              <Icon className="h-6 w-6" />
              {t(labelKey as any)}
            </button>
          ))}
        </div>
      </div>

      {/* Source-specific panel */}
      <div className="rounded-xl border border-border bg-surface p-4">
        {source === "MATH" && (
          <div className="flex items-center gap-3 text-text-secondary">
            <Calculator className="h-6 w-6 shrink-0 text-primary" />
            <p className="text-sm">{t("mtQuickMathHint")}</p>
          </div>
        )}

        {source === "SET" && (
          <div>
            <p className="mb-2 text-sm font-semibold text-text-primary">{t("mtPickSet")}</p>
            {sets === null ? (
              <p className="text-sm text-text-muted">…</p>
            ) : sets.length === 0 ? (
              <p className="text-sm text-text-muted">{t("mtNoSets")}</p>
            ) : (
              <div className="space-y-2">
                {sets.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-lg border-2 px-4 py-3",
                      selectedSet === s.id ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="set"
                        checked={selectedSet === s.id}
                        onChange={() => setSelectedSet(s.id)}
                        className="accent-primary"
                      />
                      <span className="text-sm font-semibold text-text-primary">{s.title}</span>
                    </span>
                    <span className="text-xs text-text-muted">
                      {t("mtGradeN", { n: s.grade })} · {t("itemsCount", { count: s.questionCount })}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {source === "MANUAL" && (
          <div className="space-y-3">
            <Input
              placeholder={t("mtManQuestionPh")}
              value={draft.text}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            />
            <div className="space-y-2">
              {draft.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="draft-correct"
                    title={t("mtManCorrect")}
                    checked={draft.correctIndex === i}
                    onChange={() => setDraft((d) => ({ ...d, correctIndex: i }))}
                    className="accent-primary"
                  />
                  <Input
                    placeholder={t("mtManOptionPh", { n: i + 1 })}
                    value={opt}
                    onChange={(e) => setDraftOption(i, e.target.value)}
                  />
                  {draft.options.length > 2 && (
                    <button
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          options: d.options.filter((_, j) => j !== i),
                          correctIndex: Math.min(d.correctIndex, d.options.length - 2),
                        }))
                      }
                      className="text-text-muted hover:text-error"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {draft.options.length < 4 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, options: [...d.options, ""] }))}
                >
                  <Plus className="h-4 w-4" /> {t("mtManOptionPh", { n: draft.options.length + 1 })}
                </Button>
              )}
              <Button size="sm" onClick={addManual}>
                <Plus className="h-4 w-4" /> {t("mtManAdd")}
              </Button>
              <span className="text-sm text-text-muted">{t("mtManList", { n: manual.length })}</span>
            </div>
            {manual.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {manual.map((q, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="truncate text-text-primary">
                      {q.text}{" "}
                      <span className="text-text-muted">— {q.options[q.correctIndex]}</span>
                    </span>
                    <button
                      onClick={() => setManual((m) => m.filter((_, j) => j !== i))}
                      className="shrink-0 text-text-muted hover:text-error"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {source === "AI" && (
          <div className="space-y-3">
            <Input placeholder={t("mtAiSubjectPh")} value={aiSubject} onChange={(e) => setAiSubject(e.target.value)} />
            <Input placeholder={t("mtAiTopicPh")} value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} />
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={aiGrade}
                onChange={(e) => setAiGrade(Number(e.target.value))}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
              >
                {[1, 2, 3, 4, 5, 6].map((g) => (
                  <option key={g} value={g}>
                    {t("mtGradeN", { n: g })}
                  </option>
                ))}
              </select>
              <div className="inline-flex overflow-hidden rounded-lg border border-border">
                {(["en", "am"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setAiLang(l)}
                    className={cn(
                      "px-3 py-2 text-sm font-medium",
                      aiLang === l ? "bg-primary text-white" : "bg-surface text-text-secondary",
                    )}
                  >
                    {t(l === "en" ? "mtLangEn" : "mtLangAm")}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={generateAi} isLoading={aiLoading}>
                <Sparkles className="h-4 w-4" /> {aiLoading ? t("mtGenerating") : t("mtGenerate")}
              </Button>
            </div>
            {aiRows && (
              <p className="inline-flex items-center gap-2 rounded-lg bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-700">
                <Check className="h-4 w-4" /> {t("mtReady", { n: aiRows.length })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Match options */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t("team1")} value={team1} onChange={(e) => setTeam1(e.target.value)} />
        <Input label={t("team2")} value={team2} onChange={(e) => setTeam2(e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Input
            label={t("mtMatchTime")}
            type="number"
            min={0}
            max={30}
            step={1}
            value={matchMinutes}
            onChange={(e) => setMatchMinutes(Math.max(0, Number(e.target.value)))}
          />
          <p className="mt-1 text-xs text-text-muted">{t("mtMinutesHint")}</p>
        </div>
        <div>
          <Input
            label={t("mtMatchLen")}
            type="number"
            min={2}
            max={30}
            step={1}
            value={target}
            onChange={(e) => setTarget(Math.max(2, Number(e.target.value)))}
          />
          <p className="mt-1 text-xs text-text-muted">{t("mtPullsHint")}</p>
        </div>
      </div>

      <Button size="lg" className="w-full" onClick={start} disabled={source === "AI" && (aiRows?.length ?? 0) < 2}>
        <Play className="h-5 w-5" /> {t("mtStart")}
      </Button>
    </div>
  );
}
