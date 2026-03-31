"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-center">
      <div className="rounded-full bg-error/10 p-6">
        <svg className="h-12 w-12 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.834-2.193-.834-2.963 0L3.804 16.5C3.033 18.333 3.996 20 5.536 20z" />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Something went wrong</h1>
        <p className="mt-2 text-sm text-text-secondary">{error.message || "An unexpected error occurred."}</p>
      </div>
      <button
        onClick={reset}
        className="rounded-lg bg-primary px-6 py-3 font-semibold text-white hover:bg-primary/90"
      >
        Try Again
      </button>
    </div>
  );
}
