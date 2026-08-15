import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";

/**
 * Teacher surface (grades 1–6 games). Access is TEACHER-only; every other role
 * is bounced to its own dashboard, mirroring the student/school-admin layouts.
 * Route protection lives here (there is no Next middleware wired in this app).
 */
export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/teacher");
  }

  if (user.role === "SUPER_ADMIN") {
    redirect("/admin");
  }

  if (user.role === "SCHOOL_ADMIN") {
    redirect("/school-admin");
  }

  if (user.role === "STUDENT") {
    redirect("/student");
  }

  if (user.role !== "TEACHER") {
    redirect("/login");
  }

  return <>{children}</>;
}
