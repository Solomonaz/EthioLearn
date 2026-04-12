import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/admin_ethiolearn");
  }

  // SCHOOL_ADMIN has its own dashboard at /school-admin
  if (user.role === "SCHOOL_ADMIN") {
    redirect("/school-admin");
  }

  if (user.role !== "SUPER_ADMIN") {
    redirect("/student");
  }

  return <>{children}</>;
}
