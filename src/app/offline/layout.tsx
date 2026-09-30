import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";

export const metadata: Metadata = { title: "Offline", ...NO_INDEX };

export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return children;
}
