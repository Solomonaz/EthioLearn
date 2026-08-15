import { z } from "zod";
import { getCurrentUser } from "@/lib/get-session";

/**
 * Shared auth + validation for the teacher game-content endpoints.
 *
 * These routes own the teacher's saved MCQ "sets" (GameContent of type MCQ)
 * that feed the elementary games (Tug of War today). Access is TEACHER-only,
 * with the env Super Admin allowed so the owner can test — see `ownerId`.
 */

export type Requester = {
  role: string;
  /**
   * The value to store/filter as GameContent.createdById. The env Super Admin
   * has no DB row (its id "env_super_admin" would violate the FK), so its
   * content is owned by the "system" bucket (null).
   */
  ownerId: string | null;
  isEnvSuperAdmin: boolean;
};

/** Returns the requester when they may manage teacher game content, else null. */
export async function getRequester(): Promise<Requester | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "TEACHER" && user.role !== "SUPER_ADMIN") return null;
  const isEnvSuperAdmin = user.id === "env_super_admin";
  return {
    role: user.role,
    ownerId: isEnvSuperAdmin ? null : user.id,
    isEnvSuperAdmin,
  };
}

/** Prisma `where` clause scoping content to its owner. */
export function ownerWhere(req: Requester) {
  return { createdById: req.ownerId };
}

// ─── Payload validation ─────────────────────────────────────

export const mcqSchema = z.object({
  question: z.string().trim().min(1, "Question is required").max(300),
  options: z
    .array(z.string().trim().min(1))
    .min(2, "At least 2 options")
    .max(4, "At most 4 options"),
  correctAnswer: z.string().trim().min(1, "Mark the correct option"),
});

export const gameSetSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  subject: z.string().trim().min(1).max(60).default("General"),
  grade: z.coerce.number().int().min(1).max(8),
  language: z.enum(["en", "am"]).default("en"),
  questions: z.array(mcqSchema).min(1, "Add at least one question").max(50),
});

export type GameSetInput = z.infer<typeof gameSetSchema>;

/** Validate that each question's correctAnswer is actually one of its options. */
export function assertCorrectInOptions(input: GameSetInput): string | null {
  for (const [i, q] of input.questions.entries()) {
    if (!q.options.includes(q.correctAnswer)) {
      return `Question ${i + 1}: the correct answer must be one of the options`;
    }
  }
  return null;
}
