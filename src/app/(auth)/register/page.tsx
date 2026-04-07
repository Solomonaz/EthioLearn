"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "STUDENT" | "SCHOOL_ADMIN";

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp" | "profile">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
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
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "+251" + phoneNumber, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid OTP. Please try again.");
        return;
      }
      setStep("profile");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: "+251" + phoneNumber,
          name,
          role: "STUDENT",
          grade: grade,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create account. Please try again.");
        return;
      }
      router.push("/login?registered=true");
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
          <p className="mt-2 text-text-secondary">Create your account</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          {/* Step indicator */}
          <div className="mb-6 flex justify-center gap-2">
            {["phone", "otp", "profile"].map((s, i) => (
              <div
                key={s}
                className={`h-2 w-8 rounded-full ${
                  ["phone", "otp", "profile"].indexOf(step) >= i
                    ? "bg-primary"
                    : "bg-border"
                }`}
              />
            ))}
          </div>

          {step === "phone" && (
            <form onSubmit={handleSendOtp}>
              <h2 className="mb-4 text-lg font-semibold text-text-primary">
                Your phone number
              </h2>
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
                className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Sending..." : "Send OTP"}
              </button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleVerifyOtp}>
              <h2 className="mb-2 text-lg font-semibold text-text-primary">
                Verify your number
              </h2>
              <p className="mb-4 text-sm text-text-secondary">
                Enter the 6-digit code sent to +251{phoneNumber}
              </p>
              <input
                type="text"
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="w-full rounded-lg border border-border px-4 py-3 text-center text-2xl tracking-widest text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                maxLength={6}
                required
                disabled={isLoading}
              />
              {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Verifying..." : "Verify"}
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
                Back
              </button>
            </form>
          )}

          {step === "profile" && (
            <form onSubmit={handleCreateAccount}>
              <h2 className="mb-4 text-lg font-semibold text-text-primary">
                Complete your profile
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-text-primary">
                    Full Name
                  </label>
                  <input
                    type="text"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-border px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    required
                    disabled={isLoading}
                  />
                </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Grade
                    </label>
                    <select
                      value={grade}
                      onChange={(e) => setGrade(e.target.value)}
                      className="w-full rounded-lg border border-border px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      required
                      disabled={isLoading}
                    >
                      <option value="">Select your grade</option>
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          Grade {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
              </div>
              {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Creating Account..." : "Create Account"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("otp");
                  setError("");
                }}
                className="mt-3 w-full text-sm text-text-secondary hover:text-primary"
                disabled={isLoading}
              >
                Back
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
