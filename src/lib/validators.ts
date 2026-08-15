import { z } from "zod";

export const phoneNumberSchema = z
  .string()
  .regex(/^\+251[0-9]{9}$/, "Must be a valid Ethiopian phone number (+251XXXXXXXXX)");

export const otpSchema = z
  .string()
  .length(6, "OTP must be 6 digits")
  .regex(/^[0-9]+$/, "OTP must contain only numbers");

export const registerSchema = z.object({
  phoneNumber: phoneNumberSchema,
  name: z.string().min(2, "Name must be at least 2 characters"),
  role: z.enum(["STUDENT", "SCHOOL_ADMIN", "TEACHER"]),
  grade: z.number().min(1).max(12).optional(),
  section: z.string().optional(),
  schoolId: z.string().optional(),
});

export const quizGenerateSchema = z.object({
  grade: z.number().min(1).max(12),
  subject: z.string().min(1),
  chapterId: z.string(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  questionCount: z.number().min(5).max(50).default(10),
  mode: z.enum(["SOLO", "TIMED", "GROUP"]).default("SOLO"),
});

export const createGameRoomSchema = z.object({
  grade: z.number().min(1).max(12),
  subject: z.string(),
  chapterId: z.string(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  questionCount: z.number().min(5).max(20).default(10),
  maxPlayers: z.number().min(2).max(20).default(20),
  timerSeconds: z.number().min(15).max(45).default(30),
});

export const joinGameRoomSchema = z.object({
  roomCode: z.string().length(6),
});

export const redeemRewardSchema = z.object({
  rewardId: z.string(),
});
