import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";
import { isElementaryStudent } from "@/lib/teacher-band";
import { StudentNotes } from "@/components/student/student-notes";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/student&rejected=1");
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

  if (user.role === "SECONDARY_TEACHER") {
    redirect("/secondary-teacher");
  }

  if (user.role !== "STUDENT") {
    redirect("/login");
  }

  // Grades 1-8 have their own play area; this dashboard is for grades 9-12.
  if (isElementaryStudent(user)) {
    redirect("/play");
  }

  return (
    <>
      {/* --notes-fab-clear: how far board tool buttons (graph, 3D geometry) keep
          from the right edge so they never sit under the Notes button below.
          Pages outside this layout (e.g. the public /grapher) don't set it, so
          their buttons stay in the corner. */}
      <div className="contents" style={{ "--notes-fab-clear": "76px" } as React.CSSProperties}>
        {children}
      </div>
      {/* Floating, draggable study-notes scratchpad — persists across every
          student page and only closes when the student clicks ✕. */}
      <StudentNotes />
    </>
  );
}
