import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";
import { homeRouteForRole, isElementaryStudent } from "@/lib/teacher-band";

/**
 * Play area for grades 1-8 students: the elementary games, made for one child
 * on their own phone, tablet or computer (alone, against the computer, or two
 * players sharing the device). Grades 9-12 students use /student instead.
 *
 * The grade is read from the database, never the session token: only an admin
 * changes a student's grade and the token is not refreshed when they do.
 */
export default async function PlayLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/play&rejected=1");
  }

  if (!isElementaryStudent(user)) {
    // Staff go to their own home; a grades 9-12 student, or one who has not
    // picked a grade yet, goes to /student (which asks for the grade).
    redirect(homeRouteForRole(user.role, null));
  }

  return <>{children}</>;
}
