import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";

export default async function SchoolAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/school-admin");
  }

  // Only SCHOOL_ADMIN can access /school-admin routes
  if (user.role === "SUPER_ADMIN") {
    redirect("/admin");
  }

  if (user.role !== "SCHOOL_ADMIN") {
    redirect("/student");
  }

  return <>{children}</>;
}
