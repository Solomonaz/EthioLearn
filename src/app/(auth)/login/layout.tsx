import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Sign in",
    description:
      "Sign in to Abugida — students, teachers and school admins. Use Google, Telegram, your email, " +
      "or the username your school gave you.",
    path: "/login",
  }),
  robots: { index: true, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
