import type { GenerationProgressState } from "@/components/ui/generation-progress";

/**
 * Client half of `lib/sse` — reads a `progress` / `done` / `error` stream.
 *
 * Resolves with the `done` payload, and throws on an `error` event or if the
 * stream ends without one. A stream that simply stops is a failure: silently
 * resolving would leave the caller showing a success it never received.
 */
export async function consumeSse<T>(
  res: Response,
  onProgress: (progress: GenerationProgressState) => void,
  endedEarly = "The connection ended before the work finished.",
): Promise<T> {
  if (!res.body) throw new Error(endedEarly);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: T | null = null;
  let failure: string | null = null;

  // Frames are separated by a blank line, and one frame may arrive split
  // across chunks — so whatever is left over stays in the buffer.
  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });

    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      const lines = frame.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event:"));
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!eventLine || !dataLine) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }

      const event = eventLine.slice(6).trim();
      if (event === "progress") onProgress(parsed as GenerationProgressState);
      else if (event === "done") done = parsed as T;
      else if (event === "error") failure = (parsed as { error?: string }).error ?? null;
    }
  }

  if (failure) throw new Error(failure);
  if (done === null) throw new Error(endedEarly);
  return done;
}
