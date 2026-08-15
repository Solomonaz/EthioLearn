import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";
import { StudentNotes } from "@/components/student/student-notes";

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

  if (user.role === "TEACHER") {
    redirect("/teacher");
  }

  if (user.role !== "STUDENT") {
    redirect("/login");
  }

  return (
    <>
      {children}
      {/* Floating, draggable study-notes scratchpad — persists across every
          student page and only closes when the student clicks ✕. */}
      <StudentNotes />
    </>
  );
}
