"use client";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-center">
      <div className="rounded-full bg-primary/10 p-6">
        <svg className="h-16 w-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M5.636 5.636a9 9 0 000 12.728M8.464 8.464a5 5 0 000 7.072" />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-text-primary">You&apos;re Offline</h1>
        <p className="mt-2 text-text-secondary">Check your internet connection and try again.</p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="rounded-lg bg-primary px-6 py-3 font-semibold text-white hover:bg-primary/90"
      >
        Try Again
      </button>
    </div>
  );
}
