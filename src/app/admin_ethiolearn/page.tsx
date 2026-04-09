"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        redirect: false,
        phoneNumber: "+251" + phoneNumber,
        otp,
      });

      if (result?.error) {
        setError("Invalid credentials. Enter the master phone and OTP.");
      } else {
        router.push("/admin");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-8 shadow-2xl">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 rounded-full bg-red-900/30 p-4">
            <Lock className="h-8 w-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold tracking-widest text-white">SYSTEM ADMIN</h1>
          <p className="mt-2 text-xs text-gray-400">Restricted Access Portal</p>
        </div>

        <form onSubmit={handleAdminLogin} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-gray-400">
              Master Phone Number
            </label>
            <div className="flex gap-2">
              <span className="flex items-center rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-300">
                +251
              </span>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-black px-4 py-3 text-white outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                maxLength={10}
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-gray-400">
               Master OTP
            </label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-black px-4 py-3 text-center text-2xl tracking-widest text-white outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              maxLength={6}
              required
              disabled={isLoading}
            />
          </div>

          {error && <p className="text-center text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={isLoading}
            className="mt-6 w-full rounded-lg bg-red-600 py-3 font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {isLoading ? "Authenticating..." : "AUTHORIZE"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link href="/login" className="text-xs text-gray-500 hover:text-white">
            Return to Normal Login
          </Link>
        </div>
      </div>
    </div>
  );
}
