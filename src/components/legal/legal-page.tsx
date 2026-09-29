import Link from "next/link";
import { Logo } from "@/components/ui/logo";

/** Contact for privacy questions and data requests (shown publicly). */
export const LEGAL_CONTACT_EMAIL = "solomonaz2015@gmail.com";
export const LEGAL_LAST_UPDATED = "30 September 2026";

/**
 * Shared shell for the public legal pages (/privacy, /terms). Plain, readable
 * prose; linked from the landing footer and from Google's sign-in consent
 * screen, so it must stay reachable without signing in.
 */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" aria-label="Abugida home">
            <Logo size="sm" />
          </Link>
          <nav className="flex gap-4 text-sm text-text-secondary">
            <Link href="/privacy" className="hover:text-primary">Privacy</Link>
            <Link href="/terms" className="hover:text-primary">Terms</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold text-text-primary">{title}</h1>
        <p className="mt-2 text-sm text-text-secondary">Last updated: {LEGAL_LAST_UPDATED}</p>
        <div className="mt-8 space-y-6 text-[15px] leading-7 text-text-primary [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_a]:text-primary [&_a]:underline">
          {children}
        </div>
      </main>
    </div>
  );
}
