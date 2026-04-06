"use client";

import { useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/sonner";

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
  /** Your Telegram bot username (without @) */
  botUsername: string;
  /** Where to send the user after a successful Telegram sign-in */
  callbackUrl?: string;
}

export function TelegramLoginButton({
  botUsername,
  callbackUrl = "/auth/redirect",
}: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!containerRef.current) return;

    // Expose callback for the Telegram widget
    window.TelegramLoginWidget = {
      dataOnauth: async (user: TelegramUser) => {
        try {
          const result = await signIn("telegram", {
            telegramData: JSON.stringify(user),
            redirect: false,
          });

          if (result?.error) {
            if (result.error === "CredentialsSignin") {
              toast.error(
                "Telegram account not linked. Please register first or link your Telegram in settings."
              );
            } else {
              toast.error("Telegram sign-in failed. Please try again.");
            }
            return;
          }

          if (result?.ok) {
            router.push(callbackUrl);
          }
        } catch {
          toast.error("Network error. Please try again.");
        }
      },
    };

    // Inject the Telegram Login Widget script
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
      if (container.contains(script)) {
        container.removeChild(script);
      }
    };
  }, [botUsername, callbackUrl, router]);

  return (
    <div
      ref={containerRef}
      className="flex h-10 items-center justify-center"
      aria-label="Sign in with Telegram"
    />
  );
}
