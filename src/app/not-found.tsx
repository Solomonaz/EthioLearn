import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-center">
      <div className="text-8xl font-black text-primary/20">404</div>
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Page Not Found</h1>
        <p className="mt-2 text-text-secondary">The page you&apos;re looking for doesn&apos;t exist.</p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-primary px-6 py-3 font-semibold text-white hover:bg-primary/90"
      >
        Go Home
      </Link>
    </div>
  );
}
