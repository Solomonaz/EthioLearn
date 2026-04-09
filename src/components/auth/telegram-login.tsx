"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/sonner";
import Image from "next/image";

// ── Types ────────────────────────────────────────────────────────────────────

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    TelegramLoginWidget: { dataOnauth: (user: TelegramUser) => void };
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface TelegramLoginButtonProps {
  botUsername: string;
  callbackUrl?: string;
}

export function TelegramLoginButton({
  botUsername,
  callbackUrl = "/auth/redirect",
}: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const router       = useRouter();

  // ── Confirmation state ──────────────────────────────────────────────────────
  // When Telegram fires dataOnauth we DON'T sign in immediately.
  // We store the payload and show a deliberate "Continue as …?" step.
  const [pendingUser, setPendingUser] = useState<TelegramUser | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    window.TelegramLoginWidget = {
      dataOnauth: (user: TelegramUser) => {
        // Intercept — show confirmation instead of auto-signing in
        setPendingUser(user);
      },
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "TelegramLoginWidget.dataOnauth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;

    const container = containerRef.current;
    container.appendChild(script);

    return () => {
      if (container.contains(script)) container.removeChild(script);
    };
  }, [botUsername]);

  // ── Confirm handler ─────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!pendingUser) return;
    setIsSigningIn(true);
    try {
      const result = await signIn("telegram", {
        telegramData: JSON.stringify(pendingUser),
        redirect: false,
      });

      if (result?.error) {
        if (result.error === "CredentialsSignin") {
          toast.error(
            "Telegram account not linked. Please register first or link your Telegram in settings.",
          );
        } else {
          toast.error("Telegram sign-in failed. Please try again.");
        }
        setPendingUser(null);
        return;
      }

      if (result?.ok) {
        router.push(callbackUrl);
      }
    } catch {
      toast.error("Network error. Please try again.");
      setPendingUser(null);
    } finally {
      setIsSigningIn(false);
    }
  };

  // ── Cancel handler ──────────────────────────────────────────────────────────
  const handleCancel = () => {
    setPendingUser(null);
  };

  // ── Confirmation UI ─────────────────────────────────────────────────────────
  if (pendingUser) {
    const displayName = pendingUser.username
      ? `@${pendingUser.username}`
      : [pendingUser.first_name, pendingUser.last_name].filter(Boolean).join(" ");

    return (
      <div className="w-full rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
        <p className="mb-3 text-sm font-medium text-text-primary">
          Continue as this Telegram account?
        </p>
        <div className="mb-4 flex items-center gap-3">
          {pendingUser.photo_url ? (
            <Image
              src={pendingUser.photo_url}
              alt={displayName}
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#229ED9] text-sm font-bold text-white">
              {pendingUser.first_name[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-semibold text-text-primary">{displayName}</p>
            {pendingUser.username && (
              <p className="text-xs text-text-secondary">@{pendingUser.username}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSigningIn}
            className="flex-1 rounded-lg bg-[#229ED9] py-2 text-sm font-semibold text-white hover:bg-[#1a8abf] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSigningIn ? "Signing in…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSigningIn}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Default: render Telegram widget ─────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="flex h-10 items-center justify-center"
      aria-label="Sign in with Telegram"
    />
  );
}
