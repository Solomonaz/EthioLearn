/**
 * Pull a JSON array of plottable expressions out of an AI reply, defensively.
 * Shared by the text-AI and image-AI (vision) grapher routes.
 */
export function parseEquations(text: string): string[] {
  const cleaned = text.replace(/```[a-z]*|```/gi, "").trim();

  // Preferred: a JSON array anywhere in the reply.
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        return arr
          .filter((s) => typeof s === "string")
          .map((s: string) => s.trim())
          .filter(Boolean)
          .slice(0, 6);
      }
    } catch {
      /* fall through to line parsing */
    }
  }

  // Fallback: keep lines that look like expressions in x. Split on newlines only
  // (not commas — those appear inside functions like log(x,10)); strip a single
  // leading list marker ("1.", "2)", "-", "•") without eating a coefficient.
  return cleaned
    .split(/\n+/)
    .map((s) =>
      s
        .replace(/^\s*(?:\d{1,2}[.)]\s+|[-*•]\s+)?/, "")
        .replace(/^["'`]|["'`]$/g, "")
        .trim(),
    )
    .filter((s) => s.length > 0 && s.length <= 80 && /x/i.test(s))
    .slice(0, 6);
}
