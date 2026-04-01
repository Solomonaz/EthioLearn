import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/student");
  }

  if (user.role !== "STUDENT") {
    redirect("/admin");
  }

  return <>{children}</>;
}
