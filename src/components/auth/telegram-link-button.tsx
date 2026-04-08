"use client";

import { useEffect, useRef } from "react";

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
    TelegramLinkWidget: { dataOnauth: (user: TelegramUser) => void };
  }
}

interface TelegramLinkButtonProps {
  botUsername: string;
  onAuth: (user: TelegramUser) => void;
}

export function TelegramLinkButton({ botUsername, onAuth }: TelegramLinkButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a stable ref to the callback so the effect doesn't re-run on each render
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    if (!containerRef.current) return;

    window.TelegramLinkWidget = {
      dataOnauth: (user: TelegramUser) => onAuthRef.current(user),
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "TelegramLinkWidget.dataOnauth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;

    const container = containerRef.current;
    container.appendChild(script);

    return () => {
      if (container.contains(script)) container.removeChild(script);
    };
  }, [botUsername]);

  return (
    <div
      ref={containerRef}
      className="flex h-10 items-center"
      aria-label="Link Telegram account"
    />
  );
}
