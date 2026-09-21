import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getCurrentUser } from "@/lib/get-session";

/**
 * Secondary teacher surface (grades 9–12 cohort insights).
 *
 * Access is SECONDARY_TEACHER-only; every other role is bounced to its own
 * dashboard, mirroring the student / school-admin / teacher layouts. Route
 * protection lives here — there is no Next middleware wired in this app.
 *
 * This is a sibling of /teacher, never a child of it: the grades 1–8 surface
 * gates on `role !== "TEACHER"` and must stay untouched.
 */
export default async function SecondaryTeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/secondary-teacher");
  }

  if (user.role === "SUPER_ADMIN") {
    redirect("/admin");
  }

  if (user.role === "SCHOOL_ADMIN") {
    redirect("/school-admin");
  }

  if (user.role === "TEACHER") {
    redirect("/teacher");
  }

  if (user.role === "STUDENT") {
    redirect("/student");
  }

  if (user.role !== "SECONDARY_TEACHER") {
    redirect("/login");
  }

  // Every page here is school-scoped (a teacher sees the students of their own
  // school, at the grades they teach). Show ONE clear notice rather than
  // letting each sub-page fail or, worse, fall back to an unscoped query.
  if (!user.schoolId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-lg font-bold text-text-primary">
            Your account isn&apos;t linked to a school yet
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Class insights are scoped to a school. Ask your school administrator
            to add you from{" "}
            <span className="font-medium text-text-primary">
              School Management → Teachers
            </span>
            , then sign out and back in.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
