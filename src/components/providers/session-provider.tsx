"use client";

import { SessionProvider } from "next-auth/react";
import { TokenRefreshProvider } from "./token-refresh-provider";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TokenRefreshProvider>{children}</TokenRefreshProvider>
    </SessionProvider>
  );
}
