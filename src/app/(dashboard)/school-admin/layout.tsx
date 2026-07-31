import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
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

  // A school-admin must be linked to a school — every page here is school-scoped.
  // Show ONE clear notice instead of letting each sub-page fail with a raw error.
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
            School-admin tools (students, rewards, analytics, and more) are scoped
            to a school. Ask a super-admin to assign you from{" "}
            <span className="font-medium text-text-primary">
              Schools → Add Administrator
            </span>
            , then sign out and back in.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
