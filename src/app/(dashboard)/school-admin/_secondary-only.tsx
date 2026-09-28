import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";

/**
 * Layout for the school-admin sections that only mean something at a
 * secondary school — students, textbooks, questions, rewards, student
 * analytics, tournaments and the student game settings. An elementary school
 * has no students on the school side, so its admin is sent back to the
 * dashboard instead of landing on an empty or misleading page.
 *
 * The sidebar already hides these links; this stops a typed or bookmarked URL.
 * The parent school-admin layout has already checked the role.
 */
export default async function SecondaryOnlyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (user?.school?.level === "ELEMENTARY") {
    redirect("/school-admin");
  }
  return <>{children}</>;
}
