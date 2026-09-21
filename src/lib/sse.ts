/**
 * Server-Sent Events for long-running generation routes.
 *
 * Both the activity generator and the teaching assistant keep a teacher
 * waiting on a model call, and both want to say what is actually happening
 * rather than spin. That is the same plumbing twice, so it lives here once.
 *
 * The contract every caller shares:
 *   • `progress` — { message, percent }, emitted as the work passes a stage
 *   • `done`     — the final payload, exactly the JSON the non-streaming
 *                  version of the route would have returned
 *   • `error`    — { error } and nothing else
 *
 * A route keeps its plain-JSON form for callers that do not ask to stream;
 * `?stream=1` is always opt-in.
 */

export interface ProgressInfo {
  message: string;
  percent: number;
}

export type ProgressFn = (info: ProgressInfo) => void;

export interface SseEmitter {
  progress: ProgressFn;
  /** The final payload. Sends a 100% progress tick first. */
  done: (payload: unknown) => void;
  error: (message: string) => void;
}

/**
 * Run `handler` inside an SSE stream.
 *
 * `handler` never throws past this point: an uncaught error becomes an
 * `error` event, because a stream that simply ends leaves the client hanging
 * with no way to tell success from failure.
 */
export function sseResponse(
  handler: (emit: SseEmitter) => Promise<void>,
  fallbackError = "Something went wrong",
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // The client navigated away mid-stream; nothing to do.
        }
      }

      const emit: SseEmitter = {
        progress: (info) => send("progress", info),
        done: (payload) => {
          send("progress", { message: "Done", percent: 100 });
          send("done", payload);
        },
        error: (message) => send("error", { error: message }),
      };

      try {
        await handler(emit);
      } catch (err) {
        emit.error(err instanceof Error ? err.message : fallbackError);
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
