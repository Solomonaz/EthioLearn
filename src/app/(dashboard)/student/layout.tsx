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

  if (user.role === "SUPER_ADMIN") {
    redirect("/admin");
  }

  if (user.role === "SCHOOL_ADMIN") {
    redirect("/school-admin");
  }

  if (user.role !== "STUDENT") {
    redirect("/login");
  }

  return <>{children}</>;
}
