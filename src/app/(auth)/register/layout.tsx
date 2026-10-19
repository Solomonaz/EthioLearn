import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Create your student account",
    description:
      "Sign up for Abugida with Google, Telegram or email. Practise chapter quizzes from Ethiopian textbooks, " +
      "ask the AI tutor, and compete in battles (Grades 9–12), or play learning games for your grade (Grades 1–8).",
    path: "/register",
  }),
  robots: { index: true, follow: true },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
