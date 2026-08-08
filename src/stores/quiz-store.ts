"use client";

import { create } from "zustand";
import { getQuestionSeconds } from "@/lib/quiz-timing";

interface QuizQuestionOption {
  label: string;
  text: string;
}

interface QuizQuestion {
  id: string;
  questionText: string;
  options: QuizQuestionOption[];
  type: string;
  difficulty: string;
}

// Input type: API may return options as string[] or { label, text }[]
interface QuizQuestionInput {
  id: string;
  questionText: string;
  options: (string | QuizQuestionOption)[];
  type: string;
  difficulty: string;
}

interface QuizAnswer {
  questionId: string;
  studentAnswer: string;
  timeTakenMs: number;
}

interface QuizState {
  quizId: string | null;
  questions: QuizQuestion[];
  currentIndex: number;
  answers: Map<string, QuizAnswer>;
  questionStartTime: number;
  isSubmitting: boolean;
  mode: "SOLO" | "TIMED";
  timeLeft: number;
  timerActive: boolean;

  // Actions
  startQuiz: (quizId: string, questions: QuizQuestionInput[], mode?: "SOLO" | "TIMED") => void;
  selectAnswer: (questionId: string, answer: string) => void;
  nextQuestion: () => void;
  previousQuestion: () => void;
  goToQuestion: (index: number) => void;
  setSubmitting: (value: boolean) => void;
  getSubmitPayload: () => QuizAnswer[];
  reset: () => void;
  setMode: (mode: "SOLO" | "TIMED") => void;
  setTimeLeft: (t: number) => void;
  setTimerActive: (active: boolean) => void;
}

export const useQuizStore = create<QuizState>((set, get) => ({
  quizId: null,
  questions: [],
  currentIndex: 0,
  answers: new Map(),
  questionStartTime: Date.now(),
  isSubmitting: false,
  mode: "SOLO",
  timeLeft: 30,
  timerActive: false,

  startQuiz: (quizId, questions, mode = "SOLO") => {
    // Normalize options: API may return string[] or { label, text }[]
    const LABELS = ["A", "B", "C", "D", "E", "F"];
    const normalized = questions.map((q) => ({
      ...q,
      options: q.options.map((opt: string | { label: string; text: string }, i: number) =>
        typeof opt === "string"
          ? { label: LABELS[i] || String(i + 1), text: opt }
          : opt
      ),
    }));

    set({
      quizId,
      questions: normalized,
      currentIndex: 0,
      answers: new Map(),
      questionStartTime: Date.now(),
      isSubmitting: false,
      mode,
      // Per-question time budget, scaled by the question's weight.
      timeLeft: normalized[0] ? getQuestionSeconds(normalized[0]) : 30,
      timerActive: mode === "TIMED",
    });
  },

  selectAnswer: (questionId, answer) => {
    const { answers, questionStartTime } = get();
    const timeTakenMs = Date.now() - questionStartTime;
    const newAnswers = new Map(answers);
    newAnswers.set(questionId, {
      questionId,
      studentAnswer: answer,
      timeTakenMs,
    });
    set({ answers: newAnswers });
  },

  nextQuestion: () => {
    const { currentIndex, questions } = get();
    if (currentIndex < questions.length - 1) {
      set({
        currentIndex: currentIndex + 1,
        questionStartTime: Date.now(),
      });
    }
  },

  previousQuestion: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) {
      set({
        currentIndex: currentIndex - 1,
        questionStartTime: Date.now(),
      });
    }
  },

  goToQuestion: (index) => {
    set({ currentIndex: index, questionStartTime: Date.now() });
  },

  setSubmitting: (value) => {
    set({ isSubmitting: value });
  },

  getSubmitPayload: () => {
    const { questions, answers } = get();
    return questions.map((q) => {
      const answer = answers.get(q.id);
      return {
        questionId: q.id,
        studentAnswer: answer?.studentAnswer || "",
        timeTakenMs: answer?.timeTakenMs || 0,
      };
    });
  },

  reset: () => {
    set({
      quizId: null,
      questions: [],
      currentIndex: 0,
      answers: new Map(),
      questionStartTime: Date.now(),
      isSubmitting: false,
      mode: "SOLO",
      timeLeft: 30,
      timerActive: false,
    });
  },

  setMode: (mode) => {
    set({ mode });
  },

  setTimeLeft: (t) => {
    set({ timeLeft: t });
  },

  setTimerActive: (active) => {
    set({ timerActive: active });
  },
}));
