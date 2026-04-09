"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { io, Socket } from "socket.io-client";
import {
  Trophy,
  Medal,
  Clock,
  CheckCircle,
  XCircle,
  Users,
  Crown,
  Home,
  RefreshCw,
  Swords,
  Star,
  Zap,
  BarChart2,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useAntiCheat } from "@/lib/useAntiCheat";

interface PlayerScore {
  userId: string;
  name: string;
  score: number;
  answered: number;
  socketId: string;
  correctAnswers: number;
  totalAnswerTimeMs: number;
}

interface Awards {
  mvpUserId: string | null;
  fastestFingerUserId: string | null;
}

interface GroupStats {
  avgScore: number;
  avgAccuracy: number;
  avgAnswerTimeMs: number;
}

interface QuestionData {
  index: number;
  total: number;
  question: string;
  options: string[];
  timeLimit: number;
}

type GamePhase = "connecting" | "waiting" | "countdown" | "in_progress" | "finished";

const OPTION_LABELS = ["A", "B", "C", "D"];
const OPTION_COLORS = [
  "border-blue-400 bg-blue-50 hover:bg-blue-100 text-blue-800",
  "border-orange-400 bg-orange-50 hover:bg-orange-100 text-orange-800",
  "border-purple-400 bg-purple-50 hover:bg-purple-100 text-purple-800",
  "border-green-400 bg-green-50 hover:bg-green-100 text-green-800",
];
const OPTION_COLORS_SELECTED = [
  "border-blue-500 bg-blue-200 text-blue-900",
  "border-orange-500 bg-orange-200 text-orange-900",
  "border-purple-500 bg-purple-200 text-purple-900",
  "border-green-500 bg-green-200 text-green-900",
];

export default function BattleRoomPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const roomCode = params.roomCode as string;

  const socketRef = useRef<Socket | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [phase, setPhase] = useState<GamePhase>("connecting");
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [players, setPlayers] = useState<PlayerScore[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);

  // Question state
  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(null);
  const [timeLeft, setTimeLeft] = useState(20);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [pointsEarned, setPointsEarned] = useState<number>(0);
  const [answered, setAnswered] = useState(false);

  // Results state
  const [finalScores, setFinalScores] = useState<PlayerScore[]>([]);
  const [awards, setAwards] = useState<Awards | null>(null);
  const [groupStats, setGroupStats] = useState<GroupStats | null>(null);

  // Rematch
  const [rematchVotes, setRematchVotes] = useState(0);
  const [rematchTotal, setRematchTotal] = useState(0);
  const [rematchRequested, setRematchRequested] = useState(false);

  // Disconnect tracking
  const [disconnectedPlayerIds, setDisconnectedPlayerIds] = useState<Set<string>>(new Set());

  const [error, setError] = useState<string | null>(null);

  const userId = session?.user?.id;
  const userName = session?.user?.name ?? "Player";

  // ── Anti-cheat ───────────────────────────────────────────────────────
  useAntiCheat({
    onAutoSubmit: useCallback(() => {
      if (timerRef.current) clearInterval(timerRef.current);
      socketRef.current?.disconnect();
      router.push("/student");
    }, [router]),
    enabled: phase === "in_progress",
  });

  // Timer tick
  const startTimer = useCallback((limit: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(limit);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    if (!userId) return;

    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      // Join/rejoin the room on connect — userId comes from server-side JWT auth
      socket.emit("join_room", { roomCode, name: userName });
    });

    socket.on(
      "room_updated",
      ({
        players,
        status,
        hostId,
      }: {
        players: PlayerScore[];
        status: string;
        hostId: string;
      }) => {
        setPlayers(players);
        setHostId(hostId);
        if (status === "waiting") setPhase("waiting");
        else if (status === "countdown") setPhase("countdown");
        else if (status === "in_progress") setPhase("in_progress");
      }
    );

    socket.on("connect_error", () => {
      setError("Cannot connect to game server.");
    });

    socket.on("countdown_start", ({ seconds }: { seconds: number }) => {
      setPhase("countdown");
      setCountdownSeconds(seconds);

      let count = seconds;
      const interval = setInterval(() => {
        count -= 1;
        setCountdownSeconds(count);
        if (count <= 0) clearInterval(interval);
      }, 1000);
    });

    socket.on("question", (data: QuestionData) => {
      setCurrentQuestion(data);
      setPhase("in_progress");
      setSelectedAnswer(null);
      setCorrectIndex(null);
      setIsCorrect(null);
      setPointsEarned(0);
      setAnswered(false);
      startTimer(data.timeLimit);
    });

    socket.on(
      "answer_result",
      ({
        correct,
        pointsEarned,
        correctIndex,
      }: {
        correct: boolean;
        pointsEarned: number;
        correctIndex: number;
      }) => {
        setIsCorrect(correct);
        setPointsEarned(pointsEarned);
        setCorrectIndex(correctIndex);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    );

    socket.on("scores_updated", ({ players }: { players: PlayerScore[] }) => {
      setPlayers([...players]);
    });

    socket.on("game_finished", ({ finalScores, awards, groupStats }: {
      finalScores: PlayerScore[];
      awards: Awards;
      groupStats: GroupStats;
    }) => {
      setFinalScores(finalScores);
      setAwards(awards);
      setGroupStats(groupStats);
      setPhase("finished");
      if (timerRef.current) clearInterval(timerRef.current);
    });

    // ── Disconnect / reconnect tracking ────────────────────────────────
    socket.on("player_disconnected", ({ userId: dcId }: { userId: string }) => {
      setDisconnectedPlayerIds((prev) => new Set(prev).add(dcId));
    });

    socket.on("player_reconnected", ({ userId: rcId }: { userId: string }) => {
      setDisconnectedPlayerIds((prev) => {
        const next = new Set(prev);
        next.delete(rcId);
        return next;
      });
    });

    // ── Rematch ────────────────────────────────────────────────────────
    socket.on("rematch_vote_updated", ({ votes, total }: { votes: number; total: number }) => {
      setRematchVotes(votes);
      setRematchTotal(total);
    });

    socket.on("rematch_starting", () => {
      // Reset all client-side state for the new round
      setFinalScores([]);
      setAwards(null);
      setGroupStats(null);
      setRematchVotes(0);
      setRematchTotal(0);
      setRematchRequested(false);
      setDisconnectedPlayerIds(new Set());
      setSelectedAnswer(null);
      setCorrectIndex(null);
      setIsCorrect(null);
      setPointsEarned(0);
      setAnswered(false);
      setPhase("countdown");
    });

    socket.on("error", ({ message }: { message: string }) => {
      setError(message);
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      socket.disconnect();
    };
  }, [userId, userName, roomCode, startTimer]);

  function handleAnswer(index: number) {
    if (answered || !currentQuestion || !userId) return;
    setSelectedAnswer(index);
    setAnswered(true);

    socketRef.current?.emit("submit_answer", {
      roomCode,
      questionIndex: currentQuestion.index,
      answerIndex: index,
      timeLeft,
    });
  }

  function handleRematch() {
    if (!userId || rematchRequested) return;
    setRematchRequested(true);
    socketRef.current?.emit("request_rematch", { roomCode });
  }

  const myScore = players.find((p) => p.userId === userId);
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  // ─── Connecting ───────────────────────────────────────────
  if (phase === "connecting") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
        <Spinner size="lg" className="text-primary" />
        <p className="text-text-secondary">Connecting to battle room...</p>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    );
  }

  // ─── Waiting ─────────────────────────────────────────────
  if (phase === "waiting") {
    return (
      <div className="mx-auto max-w-md p-6">
        <Card className="border-primary/20">
          <CardContent className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Swords className="h-8 w-8 text-primary" />
            </div>
            <h2 className="mb-1 text-xl font-bold text-text-primary">
              Room: {roomCode}
            </h2>
            <p className="mb-6 text-sm text-text-secondary">
              Waiting for the host to start...
            </p>

            <div className="space-y-2">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-secondary">
                <Users className="h-4 w-4" />
                <span>{players.length} player{players.length !== 1 ? "s" : ""} in room</span>
              </div>
              {players.map((p) => (
                <div
                  key={p.userId}
                  className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2"
                >
                  <Avatar name={p.name} size="sm" />
                  <span className="flex-1 text-left text-sm font-medium text-text-primary">
                    {p.name}
                  </span>
                  {p.userId === hostId && (
                    <Badge variant="warning" className="gap-1">
                      <Crown className="h-3 w-3" />
                      Host
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Countdown ───────────────────────────────────────────
  if (phase === "countdown") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm font-medium uppercase tracking-widest text-text-secondary">
          Get Ready!
        </p>
        <div className="flex h-32 w-32 items-center justify-center rounded-full bg-primary/10">
          <span className="text-7xl font-bold text-primary">{countdownSeconds}</span>
        </div>
        <p className="text-text-secondary">Battle starts in...</p>
      </div>
    );
  }

  // ─── In Progress ─────────────────────────────────────────
  if (phase === "in_progress" && currentQuestion) {
    const timerPercent = (timeLeft / currentQuestion.timeLimit) * 100;
    const timerColor =
      timeLeft > 10 ? "primary" : timeLeft > 5 ? "secondary" : "success";

    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <div className="flex gap-6">
          {/* Main Question Area */}
          <div className="flex-1 space-y-4">
            {/* Progress and Timer Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="info">
                  {currentQuestion.index + 1} / {currentQuestion.total}
                </Badge>
                <span className="text-sm text-text-secondary">
                  {myScore ? `${myScore.score} pts` : "0 pts"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock
                  className={cn(
                    "h-4 w-4",
                    timeLeft <= 5 ? "text-red-500 animate-pulse" : "text-text-secondary"
                  )}
                />
                <span
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    timeLeft <= 5 ? "text-red-500" : "text-text-primary"
                  )}
                >
                  {timeLeft}s
                </span>
              </div>
            </div>

            {/* Timer Bar */}
            <ProgressBar
              value={timerPercent}
              color={timerColor}
              size="sm"
            />

            {/* Question Card */}
            <Card>
              <CardContent className="py-6">
                <p className="text-lg font-semibold leading-relaxed text-text-primary sm:text-xl">
                  {currentQuestion.question}
                </p>
              </CardContent>
            </Card>

            {/* Answer Options */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {currentQuestion.options.map((option, i) => {
                const isSelected = selectedAnswer === i;
                const isCorrectOption = correctIndex === i;
                const showResult = answered && correctIndex !== null;

                let optionClass = "";
                if (showResult) {
                  if (isCorrectOption) {
                    optionClass =
                      "border-green-500 bg-green-100 text-green-800";
                  } else if (isSelected && !isCorrectOption) {
                    optionClass = "border-red-500 bg-red-100 text-red-800";
                  } else {
                    optionClass =
                      "border-gray-300 bg-gray-50 text-text-secondary opacity-60";
                  }
                } else if (isSelected) {
                  optionClass = OPTION_COLORS_SELECTED[i] ?? OPTION_COLORS_SELECTED[0];
                } else {
                  optionClass = OPTION_COLORS[i] ?? OPTION_COLORS[0];
                }

                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(i)}
                    disabled={answered || timeLeft === 0}
                    className={cn(
                      "relative flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all",
                      "disabled:cursor-not-allowed",
                      !answered && "cursor-pointer active:scale-[0.98]",
                      optionClass
                    )}
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/70 text-sm font-bold">
                      {OPTION_LABELS[i]}
                    </span>
                    <span className="text-sm font-medium leading-snug">
                      {option}
                    </span>
                    {showResult && isCorrectOption && (
                      <CheckCircle className="ml-auto h-5 w-5 shrink-0 text-green-600" />
                    )}
                    {showResult && isSelected && !isCorrectOption && (
                      <XCircle className="ml-auto h-5 w-5 shrink-0 text-red-600" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Answer Feedback */}
            {answered && isCorrect !== null && (
              <div
                className={cn(
                  "rounded-xl p-4 text-center",
                  isCorrect
                    ? "bg-green-50 border border-green-200"
                    : "bg-red-50 border border-red-200"
                )}
              >
                {isCorrect ? (
                  <p className="font-semibold text-green-700">
                    Correct! +{pointsEarned} points
                  </p>
                ) : (
                  <p className="font-semibold text-red-700">
                    Incorrect. The correct answer was{" "}
                    <span className="font-bold">
                      {OPTION_LABELS[correctIndex!]}
                    </span>
                  </p>
                )}
                <p className="mt-1 text-xs text-text-secondary">
                  Next question coming up...
                </p>
              </div>
            )}
          </div>

          {/* Live Scoreboard Sidebar */}
          <div className="hidden w-52 shrink-0 lg:block">
            <Card className="sticky top-6">
              <CardContent className="py-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary">
                  <Trophy className="h-4 w-4 text-yellow-500" />
                  Live Scores
                </h3>
                <ul className="space-y-2">
                  {sortedPlayers.map((p, i) => (
                    <li
                      key={p.userId}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-1.5",
                        p.userId === userId ? "bg-primary/10" : "",
                        disconnectedPlayerIds.has(p.userId) && "opacity-50"
                      )}
                    >
                      <span
                        className={cn(
                          "text-xs font-bold w-4 text-center",
                          i === 0 ? "text-yellow-500" : "text-text-secondary"
                        )}
                      >
                        {i + 1}
                      </span>
                      <Avatar name={p.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-text-primary">
                          {p.name}
                          {p.userId === userId && (
                            <span className="ml-1 text-primary">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-text-secondary">
                          {disconnectedPlayerIds.has(p.userId) ? (
                            <span className="inline-flex items-center gap-1 text-orange-500">
                              <WifiOff className="h-3 w-3" /> Disconnected
                            </span>
                          ) : (
                            `${p.score} pts`
                          )}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Mobile Scoreboard (collapsed) */}
        <div className="mt-4 lg:hidden">
          <details className="rounded-xl border border-border">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-text-primary">
              <Trophy className="h-4 w-4 text-yellow-500" />
              Live Scoreboard
            </summary>
            <div className="border-t border-border px-4 py-3">
              <ul className="space-y-1.5">
                {sortedPlayers.map((p, i) => (
                  <li
                    key={p.userId}
                    className={cn(
                      "flex items-center gap-2 text-sm",
                      disconnectedPlayerIds.has(p.userId) && "opacity-50"
                    )}
                  >
                    <span className="w-4 text-center font-bold text-text-secondary">
                      {i + 1}
                    </span>
                    <span className="flex-1 font-medium text-text-primary">
                      {p.name}
                      {p.userId === userId && (
                        <span className="ml-1 text-xs text-primary">(you)</span>
                      )}
                      {disconnectedPlayerIds.has(p.userId) && (
                        <WifiOff className="ml-1 inline h-3 w-3 text-orange-500" />
                      )}
                    </span>
                    <span className="font-bold text-primary">{p.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    );
  }

  // ─── Game Finished ────────────────────────────────────────
  if (phase === "finished") {
    const top3 = finalScores.slice(0, 3);
    const myRank = finalScores.findIndex((p) => p.userId === userId) + 1;
    const myFinalScore = finalScores.find((p) => p.userId === userId);

    const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;
    const podiumHeights = ["h-20", "h-28", "h-16"];

    // My personal stats
    const myAccuracy =
      myFinalScore && myFinalScore.answered > 0
        ? myFinalScore.correctAnswers / myFinalScore.answered
        : 0;
    const myAvgTimeMs =
      myFinalScore && myFinalScore.correctAnswers > 0
        ? myFinalScore.totalAnswerTimeMs / myFinalScore.correctAnswers
        : 0;

    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
            <Trophy className="h-9 w-9 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Battle Over!</h1>
          {myFinalScore && (
            <p className="mt-1 text-text-secondary">
              You finished{" "}
              <span className="font-bold text-primary">#{myRank}</span> with{" "}
              <span className="font-bold text-primary">
                {myFinalScore.score} points
              </span>
            </p>
          )}
        </div>

        {/* ── Awards Row ──────────────────────────────────────── */}
        {awards && (
          <div className="mb-6 grid grid-cols-2 gap-3">
            {/* MVP */}
            <Card className="border-yellow-200 bg-yellow-50/50">
              <CardContent className="py-4 text-center">
                <Star className="mx-auto mb-1.5 h-6 w-6 text-yellow-500" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-yellow-700">
                  MVP
                </p>
                <p className="mt-1 truncate text-sm font-bold text-text-primary">
                  {finalScores.find((p) => p.userId === awards.mvpUserId)?.name ?? "—"}
                </p>
                <p className="text-[10px] text-text-secondary">Highest Accuracy</p>
              </CardContent>
            </Card>

            {/* Fastest Finger */}
            <Card className="border-purple-200 bg-purple-50/50">
              <CardContent className="py-4 text-center">
                <Zap className="mx-auto mb-1.5 h-6 w-6 text-purple-500" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-purple-700">
                  Fastest Finger
                </p>
                <p className="mt-1 truncate text-sm font-bold text-text-primary">
                  {finalScores.find((p) => p.userId === awards.fastestFingerUserId)?.name ?? "—"}
                </p>
                <p className="text-[10px] text-text-secondary">Lowest Avg Time</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Personal vs. Group Stats ─────────────────────── */}
        {groupStats && myFinalScore && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-text-secondary uppercase tracking-wide">
                <BarChart2 className="h-4 w-4" />
                Your Performance vs. Group
              </h2>
              <div className="space-y-3">
                {/* Score */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Score</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-primary">{myFinalScore.score}</span>
                    <span className="text-xs text-text-secondary">vs</span>
                    <span className="text-sm font-medium text-text-secondary">
                      {groupStats.avgScore} avg
                    </span>
                    {myFinalScore.score > groupStats.avgScore ? (
                      <Badge className="bg-green-100 text-green-700 border-none text-[10px]">
                        Above
                      </Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700 border-none text-[10px]">
                        Below
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Accuracy */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Accuracy</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-primary">
                      {Math.round(myAccuracy * 100)}%
                    </span>
                    <span className="text-xs text-text-secondary">vs</span>
                    <span className="text-sm font-medium text-text-secondary">
                      {Math.round(groupStats.avgAccuracy * 100)}% avg
                    </span>
                    {myAccuracy > groupStats.avgAccuracy ? (
                      <Badge className="bg-green-100 text-green-700 border-none text-[10px]">
                        Above
                      </Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700 border-none text-[10px]">
                        Below
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Avg Answer Time */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Avg Speed</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-primary">
                      {myAvgTimeMs > 0 ? `${(myAvgTimeMs / 1000).toFixed(1)}s` : "—"}
                    </span>
                    <span className="text-xs text-text-secondary">vs</span>
                    <span className="text-sm font-medium text-text-secondary">
                      {groupStats.avgAnswerTimeMs > 0
                        ? `${(groupStats.avgAnswerTimeMs / 1000).toFixed(1)}s avg`
                        : "— avg"}
                    </span>
                    {myAvgTimeMs > 0 && groupStats.avgAnswerTimeMs > 0 && myAvgTimeMs < groupStats.avgAnswerTimeMs ? (
                      <Badge className="bg-green-100 text-green-700 border-none text-[10px]">
                        Faster
                      </Badge>
                    ) : myAvgTimeMs > 0 ? (
                      <Badge className="bg-red-100 text-red-700 border-none text-[10px]">
                        Slower
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Podium — only show if 2+ players */}
        {finalScores.length >= 2 && top3.length >= 2 && (
          <div className="mb-6 flex items-end justify-center gap-3">
            {podiumOrder.map((player, slot) => {
              if (!player) return <div key={slot} className="w-28" />;
              const rank =
                finalScores.findIndex((p) => p.userId === player.userId) + 1;
              const isMe = player.userId === userId;
              const medalColor =
                rank === 1
                  ? "text-yellow-500"
                  : rank === 2
                  ? "text-gray-400"
                  : "text-orange-400";

              return (
                <div
                  key={player.userId}
                  className="flex w-28 flex-col items-center gap-2"
                >
                  <Avatar name={player.name} size="lg" />
                  <p
                    className={cn(
                      "truncate text-sm font-semibold text-text-primary",
                      isMe && "text-primary"
                    )}
                  >
                    {player.name}
                    {isMe && " (you)"}
                  </p>
                  <p className="text-xs font-bold text-text-secondary">
                    {player.score} pts
                  </p>
                  <div
                    className={cn(
                      "flex w-full items-center justify-center rounded-t-lg",
                      rank === 1
                        ? "bg-yellow-100"
                        : rank === 2
                        ? "bg-gray-100"
                        : "bg-orange-50",
                      podiumHeights[slot]
                    )}
                  >
                    <Medal className={cn("h-6 w-6", medalColor)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Full Leaderboard with award badges */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <h2 className="mb-3 text-sm font-bold text-text-secondary uppercase tracking-wide">
              Final Rankings
            </h2>
            <ul className="space-y-2">
              {finalScores.map((p, i) => {
                const isMe = p.userId === userId;
                const rankBadge =
                  i === 0
                    ? "bg-yellow-100 text-yellow-700"
                    : i === 1
                    ? "bg-gray-100 text-gray-600"
                    : i === 2
                    ? "bg-orange-100 text-orange-600"
                    : "bg-gray-50 text-text-secondary";

                const isMvp = awards?.mvpUserId === p.userId;
                const isFastest = awards?.fastestFingerUserId === p.userId;

                return (
                  <li
                    key={p.userId}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5",
                      isMe
                        ? "bg-primary/10 border border-primary/20"
                        : "bg-gray-50"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                        rankBadge
                      )}
                    >
                      {i + 1}
                    </span>
                    <Avatar name={p.name} size="sm" />
                    <span className="flex-1 text-sm font-semibold text-text-primary">
                      {p.name}
                      {isMe && (
                        <span className="ml-1 text-xs font-normal text-primary">
                          (you)
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isMvp && (
                        <span title="MVP" className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-100">
                          <Star className="h-3 w-3 text-yellow-600" />
                        </span>
                      )}
                      {isFastest && (
                        <span title="Fastest Finger" className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100">
                          <Zap className="h-3 w-3 text-purple-600" />
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-primary">{p.score}</span>
                    <span className="text-xs text-text-secondary">pts</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="lg"
            className="flex-1 gap-2"
            onClick={() => router.push("/student")}
          >
            <Home className="h-4 w-4" />
            Home
          </Button>
          <Button
            size="lg"
            className="flex-1 gap-2"
            onClick={handleRematch}
            disabled={rematchRequested}
          >
            <RotateCcw className="h-4 w-4" />
            {rematchRequested
              ? `Rematch (${rematchVotes}/${rematchTotal})`
              : "Rematch"}
          </Button>
        </div>
        {rematchRequested && rematchVotes < rematchTotal && (
          <p className="mt-2 text-center text-xs text-text-secondary animate-pulse">
            Waiting for all players to accept rematch… ({rematchVotes}/{rematchTotal})
          </p>
        )}
      </div>
    );
  }

  // Fallback
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner size="lg" className="text-primary" />
    </div>
  );
}
