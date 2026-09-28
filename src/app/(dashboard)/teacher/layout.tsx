import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getCurrentUser } from "@/lib/get-session";

/**
 * Teacher surface (grades 1–8 games). Access is TEACHER-only; every other role
 * is bounced to its own dashboard, mirroring the student/school-admin layouts.
 * Route protection lives here (there is no Next middleware wired in this app).
 *
 * Grades 1-8 teachers get access through their school's subscription, so a
 * teacher with no school sees one clear notice instead of the dashboard.
 */
export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/teacher&rejected=1");
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

  if (user.role === "SECONDARY_TEACHER") {
    redirect("/secondary-teacher");
  }

  if (user.role !== "TEACHER") {
    redirect("/login");
  }

  if (!user.schoolId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-lg font-bold text-text-primary">
            Your account isn&apos;t linked to a school
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Teachers use EthioLearn through their school. Ask your school&apos;s
            EthioLearn administrator to add you, then sign in again.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
