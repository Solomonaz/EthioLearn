import type { UserRole, Difficulty, QuizMode, QuestionType } from "@prisma/client";

export type { UserRole, Difficulty, QuizMode, QuestionType };

export interface SessionUser {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
}

export interface QuizConfig {
  grade: number;
  subject: string;
  chapterId: string;
  difficulty: Difficulty;
  questionCount: number;
  timerSeconds?: number;
}

export interface GameState {
  roomCode: string;
  currentQuestion: number;
  totalQuestions: number;
  players: GamePlayerState[];
  status: "waiting" | "active" | "completed";
}

export interface GamePlayerState {
  userId: string;
  name: string;
  avatarUrl?: string;
  score: number;
  rank: number;
  streak: number;
}

export interface QuizResult {
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  totalPoints: number;
  timeTaken: number;
  accuracy: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string;
  totalPoints: number;
  xpLevel: number;
  quizCount: number;
}
