import { McqBuilder } from "@/components/teacher/mcq-builder";

/**
 * Create & manage the MCQ question sets that feed the elementary games.
 * `?edit=<id>` opens straight into that set (used by the dashboard's Edit action).
 */
export default async function CreateGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  return <McqBuilder initialEditId={edit} />;
}
