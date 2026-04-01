import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/admin");
  }

  if (user.role !== "SUPER_ADMIN" && user.role !== "SCHOOL_ADMIN") {
    redirect("/student");
  }

  return <>{children}</>;
}
