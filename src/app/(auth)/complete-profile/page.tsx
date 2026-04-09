"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export default function CompleteProfilePage() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const [grade, setGrade]         = useState<number | "">("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState("");

  const displayName = session?.user?.name ?? "there";

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grade) { setError("Please select your grade."); return; }
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/students/me/complete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: Number(grade), socialUser: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save. Please try again.");
        return;
      }
      await update();
      router.replace("/student");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="text-3xl font-bold text-primary">
            EthioLearn
          </Link>
          <p className="mt-2 text-text-secondary">One last step, {displayName}!</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <form onSubmit={handleSaveGrade} className="space-y-5">
            <div>
              <h2 className="mb-1 text-xl font-semibold text-text-primary">
                What grade are you in?
              </h2>
              <p className="mb-5 text-sm text-text-secondary">
                This helps us personalise quizzes and content to your curriculum.
              </p>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                required
                disabled={isLoading}
              >
                <option value="">Select your grade</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>Grade {g}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Saving…" : "Continue to Dashboard"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
