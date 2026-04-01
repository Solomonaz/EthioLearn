"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { signIn, getSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "true";
  const callbackUrl = searchParams.get("callbackUrl") ?? "";

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "+251" + phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send OTP. Please try again.");
        return;
      }
      setStep("otp");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const result = await signIn("credentials", {
        phoneNumber: "+251" + phoneNumber,
        otp,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid OTP or account not found.");
        return;
      }

      if (result?.ok) {
        // Get the fresh session to determine the user's role
        const session = await getSession();
        const role = (session?.user as { role?: string } | undefined)?.role;
        const isAdmin = role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN";

        // Honor callbackUrl only if it matches the user's allowed area
        if (callbackUrl) {
          const isAdminCallback = callbackUrl.startsWith("/admin");
          const isStudentCallback = callbackUrl.startsWith("/student");
          if ((isAdmin && isAdminCallback) || (!isAdmin && isStudentCallback)) {
            router.push(callbackUrl);
            return;
          }
        }

        router.push(isAdmin ? "/admin" : "/student");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
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
          <p className="mt-2 text-text-secondary">Sign in to your account</p>
        </div>

        {justRegistered && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-center text-sm text-green-700">
            Account created! Please sign in.
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          {step === "phone" ? (
            <form onSubmit={handleSendOtp}>
              <label className="mb-2 block text-sm font-medium text-text-primary">
                Phone Number
              </label>
              <div className="flex gap-2">
                <span className="flex items-center rounded-lg border border-border bg-gray-50 px-3 text-sm text-text-secondary">
                  +251
                </span>
                <input
                  type="tel"
                  placeholder="9XXXXXXXX"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full rounded-lg border border-border px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  maxLength={9}
                  required
                  disabled={isLoading}
                />
              </div>
              {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Sending..." : "Send OTP"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <p className="mb-4 text-sm text-text-secondary">
                We sent a 6-digit code to +251{phoneNumber}
              </p>
              <label className="mb-2 block text-sm font-medium text-text-primary">
                Enter OTP
              </label>
              <input
                type="text"
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="w-full rounded-lg border border-border px-4 py-3 text-center text-2xl tracking-widest text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                maxLength={6}
                required
                disabled={isLoading}
                autoFocus
              />
              {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Verifying..." : "Verify & Sign In"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError("");
                  setOtp("");
                }}
                className="mt-3 w-full text-sm text-text-secondary hover:text-primary"
                disabled={isLoading}
              >
                Change phone number
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
