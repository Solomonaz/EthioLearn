import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-session";
import { GrapherApp } from "@/components/student/grapher/grapher-app";
import { NO_INDEX } from "@/lib/site";

export const metadata: Metadata = { title: "Grapher", ...NO_INDEX };

/**
 * Standalone, chrome-free grapher — opened as its own window from the in-app
 * grapher ("Open in window") so students can keep it beside their study
 * material. Auth-guarded but layout-free (no sidebar/navbar). It's just a math
 * tool, so any signed-in user may use it.
 */
export default async function StandaloneGrapherPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/grapher");

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <GrapherApp standalone />
      </div>
    </main>
  );
}
