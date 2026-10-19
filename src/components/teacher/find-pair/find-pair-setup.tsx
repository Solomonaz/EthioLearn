"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Layers,
  FolderOpen,
  PencilLine,
  Sparkles,
  Plus,
  Trash2,
  Check,
  Play,
  Grid2x2,
  Columns2,
  Puzzle,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StoredMcq } from "@/lib/games/tug-of-war";
import {
  FP,
  PRESETS,
  cleanPairs,
  pairsFromMcq,
  pairsFromPreset,
  type Pair,
  type PairConfig,
  type PairMatch,
  type PairMode,
  type PairSource,
} from "@/lib/games/find-pair";
import { AI_GENERATE_URL, PLAY_BILLING_HREF, type GameAudience } from "@/lib/games/play";

interface SavedSet {
  id: string;
  title: string;
  subject: string;
  grade: number;
  questionCount: number;
}

const SOURCE_META: { key: PairSource; icon: typeof Layers; labelKey: string }[] = [
  { key: "PRESET", icon: Layers, labelKey: "fpSourcePreset" },
  { key: "MANUAL", icon: PencilLine, labelKey: "fpSourceManual" },
  { key: "SET", icon: FolderOpen, labelKey: "mtSourceSet" },
  { key: "AI", icon: Sparkles, labelKey: "mtSourceAI" },
];

export function FindPairSetup({
  onStart,
  initialSetId,
  audience = "teacher",
  aiLocked = false,
}: {
  onStart: (match: PairMatch) => void;
  initialSetId?: string;
  /** "student": a grades 1-8 student's own device — no saved class sets, and
      AI questions are made for the student's own grade. */
  audience?: GameAudience;
  /** Student only: their plan has no AI, so the AI source shows an upgrade note. */
  aiLocked?: boolean;
}) {
  const t = useTranslations("games");
  const isStudent = audience === "student";
  // Saved question sets belong to teachers.
  const sources = isStudent ? SOURCE_META.filter((s) => s.key !== "SET") : SOURCE_META;

  const [source, setSource] = useState<PairSource>(initialSetId ? "SET" : "PRESET");
  const [mode, setMode] = useState<PairMode>("flip");
  const [perRound, setPerRound] = useState<number>(FP.DEFAULT_PER_ROUND);
  const [roundSeconds, setRoundSeconds] = useState<number>(FP.DEFAULT_ROUND_SECONDS);

  // Custom column headings (default to the chosen content's own labels).
  const [leftLabel, setLeftLabel] = useState("");
  const [rightLabel, setRightLabel] = useState("");

  // PRESET
  const [presetKey, setPresetKey] = useState(PRESETS[0].key);

  // MANUAL
  const [manual, setManual] = useState<Pair[]>([]);
  const [draft, setDraft] = useState<{ left: string; right: string }>({ left: "", right: "" });

  // SET
  const [sets, setSets] = useState<SavedSet[] | null>(null);
  const [selectedSet, setSelectedSet] = useState<string>(initialSetId ?? "");

  // AI
  const [aiSubject, setAiSubject] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiGrade, setAiGrade] = useState(3);
  const [aiLang, setAiLang] = useState<"en" | "am">("en");
  const [aiRows, setAiRows] = useState<StoredMcq[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (isStudent) return;
    fetch("/api/teacher/games")
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d) => setSets(d.games ?? []))
      .catch(() => setSets([]));
  }, [isStudent]);

  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];

  // Effective column headings: teacher override wins, else the source's defaults.
  const defaultLabels = (): { left: string; right: string } => {
    if (source === "PRESET") return { left: preset.leftLabel, right: preset.rightLabel };
    if (source === "MANUAL") return { left: t("fpLeftDefault"), right: t("fpRightDefault") };
    return { left: t("fpQuestion"), right: t("fpAnswer") };
  };

  // ── Manual pair builder ───────────────────────────────────
  const addManual = () => {
    const left = draft.left.trim();
    const right = draft.right.trim();
    if (!left || !right) {
      toast.error(t("fpManualInvalid"));
      return;
    }
    setManual((m) => [...m, { id: `man-${Date.now()}-${m.length}`, left, right }]);
    setDraft({ left: "", right: "" });
  };

  // ── AI generation (reuses the MCQ generator: question ↔ answer) ──
  const generateAi = async () => {
    if (!aiTopic.trim()) {
      toast.error(t("mtAiTopicPh"));
      return;
    }
    setAiLoading(true);
    setAiRows(null);
    try {
      // A student's questions are always for their own grade (set server-side).
      const res = await fetch(AI_GENERATE_URL[audience], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: aiSubject || "General",
          topic: aiTopic,
          ...(isStudent ? {} : { grade: aiGrade }),
          language: aiLang,
          count: 10,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t("mtGenError"));
      const rows = (data?.questions ?? []) as StoredMcq[];
      if (rows.length === 0) throw new Error(t("mtGenError"));
      setAiRows(rows);
      toast.success(t("mtReady", { n: rows.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mtGenError"));
    } finally {
      setAiLoading(false);
    }
  };

  // ── Build the deck & start ────────────────────────────────
  const buildDeck = async (): Promise<Pair[] | null> => {
    if (source === "PRESET") return pairsFromPreset(preset);
    if (source === "MANUAL") {
      if (manual.length < FP.MIN_PAIRS) {
        toast.error(t("fpNeedPairs"));
        return null;
      }
      return cleanPairs(manual);
    }
    if (source === "AI") {
      const deck = pairsFromMcq(aiRows ?? [], "ai");
      if (deck.length < FP.MIN_PAIRS) {
        toast.error(t("fpNeedPairs"));
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
    const deck = pairsFromMcq((data.game?.questions ?? []) as StoredMcq[], "set");
    if (deck.length < FP.MIN_PAIRS) {
      toast.error(t("fpNeedPairs"));
      return null;
    }
    return deck;
  };

  const start = async () => {
    const deck = await buildDeck();
    if (!deck) return;
    const labels = defaultLabels();
    const config: PairConfig = {
      leftLabel: leftLabel.trim() || labels.left,
      rightLabel: rightLabel.trim() || labels.right,
      mode,
      perRound: Math.max(FP.MIN_PAIRS, Math.min(FP.MAX_PER_ROUND, Math.round(perRound) || FP.DEFAULT_PER_ROUND)),
      roundSeconds,
    };
    onStart({ config, pairs: deck });
  };

  const aiDisabled = source === "AI" && (aiLocked || (aiRows?.length ?? 0) < FP.MIN_PAIRS);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div
        className="relative overflow-hidden rounded-3xl p-6 shadow-md"
        style={{ backgroundImage: "linear-gradient(135deg,#7C3AED,#A78BFA)" }}
      >
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/15" />
        <div className="pointer-events-none absolute -bottom-10 left-24 h-28 w-28 rounded-full bg-black/10" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/25 backdrop-blur-sm">
            <Puzzle className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white sm:text-3xl">{t("findPair")} 🧩</h1>
            <p className="mt-0.5 text-sm font-medium text-white/85">{t("fpSubtitle")}</p>
          </div>
        </div>
      </div>

      {/* Mode: flip vs match */}
      <div>
        <p className="mb-2 text-sm font-semibold text-text-primary">{t("fpMode")}</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { key: "flip", icon: Grid2x2, label: "fpModeFlip", hint: "fpModeFlipHint" },
              { key: "match", icon: Columns2, label: "fpModeMatch", hint: "fpModeMatchHint" },
            ] as const
          ).map(({ key, icon: Icon, label, hint }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border-2 px-4 py-3 text-left transition-colors",
                mode === key
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface hover:border-primary/40",
              )}
            >
              <span className="flex items-center gap-2 font-semibold text-text-primary">
                <Icon className="h-5 w-5 text-primary" /> {t(label)}
              </span>
              <span className="text-xs text-text-secondary">{t(hint)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Source picker */}
      <div>
        <p className="mb-2 text-sm font-semibold text-text-primary">{t("fpSource")}</p>
        <div className={cn("grid grid-cols-2 gap-2", sources.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          {sources.map(({ key, icon: Icon, labelKey }) => (
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
              <span className="inline-flex items-center gap-1">
                {t(labelKey)}
                {key === "AI" && aiLocked && <Lock className="h-3.5 w-3.5" />}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Source-specific panel */}
      <div className="rounded-xl border border-border bg-surface p-4">
        {source === "PRESET" && (
          <div className="space-y-2">
            <p className="mb-1 text-sm font-semibold text-text-primary">{t("fpPresetPick")}</p>
            {PRESETS.map((p) => (
              <label
                key={p.key}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-lg border-2 px-4 py-3",
                  presetKey === p.key ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="preset"
                    checked={presetKey === p.key}
                    onChange={() => setPresetKey(p.key)}
                    className="accent-primary"
                  />
                  <span className="text-sm font-semibold text-text-primary">{t(p.titleKey)}</span>
                </span>
                <span className="text-xs text-text-muted">
                  {p.leftLabel} · {p.rightLabel} · {t("itemsCount", { count: p.pairs.length })}
                </span>
              </label>
            ))}
          </div>
        )}

        {source === "MANUAL" && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder={leftLabel.trim() || t("fpLeftDefault")}
                value={draft.left}
                onChange={(e) => setDraft((d) => ({ ...d, left: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addManual()}
              />
              <Input
                placeholder={rightLabel.trim() || t("fpRightDefault")}
                value={draft.right}
                onChange={(e) => setDraft((d) => ({ ...d, right: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addManual()}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={addManual}>
                <Plus className="h-4 w-4" /> {t("fpAddPair")}
              </Button>
              <span className="text-sm text-text-muted">{t("fpPairsList", { n: manual.length })}</span>
            </div>
            {manual.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {manual.map((p, i) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="truncate text-text-primary">
                      {p.left} <span className="text-text-muted">↔ {p.right}</span>
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

        {source === "AI" && aiLocked && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
            <Lock className="h-5 w-5 shrink-0 text-primary" />
            <p className="min-w-0 flex-1">{t("playAiLocked")}</p>
            <Link href={PLAY_BILLING_HREF} className="font-semibold text-primary hover:underline">
              {t("playSeePlans")}
            </Link>
          </div>
        )}

        {source === "AI" && !aiLocked && (
          <div className="space-y-3">
            <Input placeholder={t("mtAiSubjectPh")} value={aiSubject} onChange={(e) => setAiSubject(e.target.value)} />
            <Input placeholder={t("mtAiTopicPh")} value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} />
            <div className="flex flex-wrap items-center gap-3">
              {!isStudent && (
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
              )}
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
              <p className="inline-flex items-center gap-2 rounded-lg bg-success/10 px-3 py-1.5 text-sm font-semibold text-success">
                <Check className="h-4 w-4" /> {t("mtReady", { n: aiRows.length })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Column headings (flexible) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Input
            label={t("fpLeftLabel")}
            placeholder={defaultLabels().left}
            value={leftLabel}
            onChange={(e) => setLeftLabel(e.target.value)}
            maxLength={24}
          />
          <p className="mt-1 text-xs text-text-muted">{t("fpLabelHint")}</p>
        </div>
        <div>
          <Input
            label={t("fpRightLabel")}
            placeholder={defaultLabels().right}
            value={rightLabel}
            onChange={(e) => setRightLabel(e.target.value)}
            maxLength={24}
          />
        </div>
      </div>

      {/* Round options */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Input
            label={t("fpPerRound")}
            type="number"
            min={FP.MIN_PAIRS}
            max={FP.MAX_PER_ROUND}
            step={1}
            value={perRound}
            onChange={(e) => setPerRound(Number(e.target.value))}
            className="max-w-[9rem]"
          />
          <p className="mt-1 text-xs text-text-muted">{t("fpPerRoundHint")}</p>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-text-primary">{t("fpRoundTime")}</p>
          <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-border">
            {FP.ROUND_SECONDS_CHOICES.map((s) => (
              <button
                key={s}
                onClick={() => setRoundSeconds(s)}
                className={cn(
                  "px-3 py-2 text-sm font-semibold",
                  roundSeconds === s ? "bg-primary text-white" : "bg-surface text-text-secondary",
                )}
              >
                {s === 0 ? t("fpNoLimit") : t("fpSeconds", { n: s })}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-text-muted">{t("fpRoundTimeHint")}</p>
        </div>
      </div>

      <Button size="lg" className="w-full" onClick={start} disabled={aiDisabled}>
        <Play className="h-5 w-5" /> {t("mtStart")}
      </Button>
    </div>
  );
}
