"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import {
  Swords,
  Copy,
  Check,
  Users,
  Crown,
  Play,
  LogIn,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import { useEntitlements } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

interface PlayerInfo {
  userId: string;
  name: string;
  score: number;
  answered: number;
  socketId: string;
}

interface BattleQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

type ActiveTab = "create" | "join";

// Battle-ready subject with its available MCQ count, scoped to the student's grade.
interface BattleSubject {
  name: string;
  count: number;
}

const SELECT_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm font-medium text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary";

// Sensible battle sizes: capped at 30 (30 questions already runs ~10 min) and
// never more than the subject has. Always includes the true max so a small
// subject shows its real limit. Scales cleanly no matter how many questions exist.
function battleCountOptions(available: number): number[] {
  const cap = Math.min(available, 30);
  if (cap < 1) return [];
  const set = new Set<number>([5, 10, 15, 20, 30].filter((n) => n <= cap));
  set.add(cap);
  return [...set].sort((a, b) => a - b);
}

export default function BattleLobbyPage() {
  const { data: session } = useSession();
  const ent = useEntitlements();
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("create");

  // Create room state — subjects/grade are scoped to the student's profile.
  const [subjects, setSubjects] = useState<BattleSubject[]>([]);
  const [grade, setGrade] = useState<number | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [creating, setCreating] = useState(false);
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [startingGame, setStartingGame] = useState(false);

  useEffect(() => {
    async function fetchOptions() {
      try {
        const res = await fetch("/api/battles/options");
        if (res.ok) {
          const data = (await res.json()) as { grade: number | null; subjects: BattleSubject[] };
          setGrade(data.grade);
          setSubjects(data.subjects);
          if (data.subjects.length > 0) {
            setSelectedSubject(data.subjects[0].name);
            setQuestionCount(Math.min(10, data.subjects[0].count));
          }
        }
      } catch (err) {
        console.error("Failed to fetch battle options", err);
      } finally {
        setLoadingOptions(false);
      }
    }
    fetchOptions();
  }, []);

  // Join room state
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Shared state
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [roomStatus, setRoomStatus] = useState<string>("waiting");
  const [hostId, setHostId] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [inRoom, setInRoom] = useState(false);
  const [currentRoomCode, setCurrentRoomCode] = useState<string | null>(null);

  // Questions stored for socket (only host has these)
  const questionsRef = useRef<BattleQuestion[]>([]);

  const userId = session?.user?.id;
  const userName = session?.user?.name ?? "Player";

  useEffect(() => {
    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
    });

    socket.on("room_created", ({ roomCode }: { roomCode: string }) => {
      setCreatedRoomCode(roomCode);
      setCurrentRoomCode(roomCode);
      setInRoom(true);
      router.push(`/student/battle/${roomCode}`);
    });

    socket.on(
      "room_updated",
      ({
        players,
        status,
        hostId,
      }: {
        players: PlayerInfo[];
        status: string;
        hostId: string;
      }) => {
        setPlayers(players);
        setRoomStatus(status);
        setHostId(hostId);
      }
    );

    socket.on("countdown_start", () => {
      if (currentRoomCode) {
        router.push(`/student/battle/${currentRoomCode}`);
      }
    });

    socket.on("error", ({ message }: { message: string }) => {
      setSocketError(message);
      setJoinError(message);
      setJoining(false);
    });

    socket.on("connect_error", () => {
      setSocketError(
        "Cannot connect to game server. Make sure the server is running with 'npm run dev'."
      );
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle countdown_start needing current roomCode
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleCountdown = () => {
      if (currentRoomCode) {
        router.push(`/student/battle/${currentRoomCode}`);
      }
    };

    socket.off("countdown_start");
    socket.on("countdown_start", handleCountdown);

    return () => {
      socket.off("countdown_start", handleCountdown);
    };
  }, [currentRoomCode, router]);

  async function handleCreateRoom() {
    if (!userId) return;
    setCreating(true);
    setSocketError(null);

    try {
      const res = await fetch("/api/battles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Grade is derived server-side from the student's profile.
        body: JSON.stringify({
          subject: selectedSubject,
          questionCount,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSocketError(data.error || "Failed to create room");
        return;
      }

      questionsRef.current = data.questions;

      // Check socket is connected before emitting
      if (!socketRef.current?.connected) {
        setSocketError("Not connected to game server. Please refresh and try again.");
        return;
      }

      // Emit create_room to socket server
      socketRef.current.emit("create_room", {
        roomCode: data.roomCode,
        hostName: userName,
        questions: data.questions,
      });

      setCreatedRoomCode(data.roomCode);
      setCurrentRoomCode(data.roomCode);
      setInRoom(true);
      setHostId(userId);
    } catch {
      setSocketError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom() {
    if (!userId || !joinCode.trim()) return;
    const code = joinCode.trim();

    setJoining(true);
    setJoinError(null);

    try {
      // Verify room exists via REST
      const res = await fetch(`/api/battles?roomCode=${code}`);
      const data = await res.json();

      if (!res.ok) {
        setJoinError(data.error || "Room not found");
        setJoining(false);
        return;
      }

      router.push(`/student/battle/${code}`);
    } catch {
      setJoinError("Network error. Please try again.");
    } finally {
      setJoining(false);
    }
  }

  function handleStartGame() {
    if (!currentRoomCode || !userId || players.length < 2) return;
    setStartingGame(true);
    socketRef.current?.emit("start_game", { roomCode: currentRoomCode });
  }

  function handleCopyCode() {
    if (!createdRoomCode) return;
    navigator.clipboard.writeText(createdRoomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Selecting a subject snaps the chosen count to a valid option for it.
  function handleSelectSubject(name: string, count: number) {
    setSelectedSubject(name);
    const opts = battleCountOptions(count);
    setQuestionCount((prev) =>
      opts.includes(prev) ? prev : opts.includes(10) ? 10 : (opts[opts.length - 1] ?? 0),
    );
  }

  const availableCount =
    subjects.find((s) => s.name === selectedSubject)?.count ?? 0;
  const questionOptions = battleCountOptions(availableCount);

  // Keep the chosen count valid whenever the available pool changes (e.g. on load).
  useEffect(() => {
    if (questionOptions.length > 0 && !questionOptions.includes(questionCount)) {
      setQuestionCount(questionOptions.includes(10) ? 10 : questionOptions[questionOptions.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCount]);

  const isHost = userId === hostId;
  const canStart = isHost && players.length >= 2 && roomStatus === "waiting";

  // Plan gating — battle mode requires a plan that allows multiplayer.
  if (!ent.loading && !ent.multiplayer) {
    return <UpgradeNotice feature="Battle Mode" planName={ent.planName} />;
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-3">
          <Swords className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Battle Mode</h1>
          <p className="text-sm text-text-secondary">
            Challenge friends in real-time quiz battles
          </p>
        </div>
      </div>

      {/* Tabs — only show when not in a room */}
      {!inRoom && (
        <div className="mb-6 flex gap-2 rounded-xl bg-gray-100 p-1">
          <button
            onClick={() => setActiveTab("create")}
            className={cn(
              "flex-1 rounded-lg py-2 text-sm font-semibold transition-colors",
              activeTab === "create"
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            Create Room
          </button>
          <button
            onClick={() => setActiveTab("join")}
            className={cn(
              "flex-1 rounded-lg py-2 text-sm font-semibold transition-colors",
              activeTab === "join"
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            Join Room
          </button>
        </div>
      )}

      {socketError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {socketError}
        </div>
      )}

      {/* Create Tab */}
      {activeTab === "create" && !inRoom && (
        <>
          {loadingOptions ? (
            <div className="flex items-center justify-center py-10">
              <Spinner size="sm" className="text-primary" />
            </div>
          ) : subjects.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-text-secondary">
              {grade
                ? `No battle-ready subjects for Grade ${grade} yet. Ask your teacher to add questions.`
                : "Your profile has no grade set. Complete your profile to play battles."}
            </div>
          ) : (
            <Card>
              <CardContent className="space-y-6 p-5 sm:p-6">
                {/* Subject — dropdown, scales to any number of subjects */}
                <div>
                  <label htmlFor="battle-subject" className="mb-2 block text-sm font-semibold text-text-primary">
                    Subject
                  </label>
                  <select
                    id="battle-subject"
                    value={selectedSubject}
                    onChange={(e) => {
                      const s = subjects.find((x) => x.name === e.target.value);
                      if (s) handleSelectSubject(s.name, s.count);
                    }}
                    className={SELECT_CLASS}
                  >
                    {subjects.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.count} question{s.count === 1 ? "" : "s"})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Questions — dropdown; grade shown inline as a subtle note */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label htmlFor="battle-count" className="text-sm font-semibold text-text-primary">
                      Questions
                    </label>
                    <span className="text-xs text-text-secondary">
                      Grade {grade} · your grade
                    </span>
                  </div>
                  <select
                    id="battle-count"
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                    className={SELECT_CLASS}
                  >
                    {questionOptions.map((n) => (
                      <option key={n} value={n}>
                        {n} question{n === 1 ? "" : "s"}
                        {n === availableCount ? " (all)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  size="lg"
                  className="w-full gap-2"
                  onClick={handleCreateRoom}
                  isLoading={creating}
                  disabled={creating || availableCount < 1}
                >
                  <Swords className="h-5 w-5" />
                  Create Battle Room
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Join Tab */}
      {activeTab === "join" && !inRoom && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 py-5">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-text-primary">
                  Room Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={joinCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                    setJoinCode(val);
                    setJoinError(null);
                  }}
                  placeholder="Enter 4-digit code"
                  maxLength={4}
                  className="w-full rounded-lg border border-border bg-white px-4 py-3 text-center text-2xl font-bold tracking-widest text-text-primary placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-text-secondary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {joinError && (
                  <p className="mt-1.5 text-sm text-red-600">{joinError}</p>
                )}
              </div>

              <Button
                size="lg"
                className="w-full gap-2"
                onClick={handleJoinRoom}
                isLoading={joining}
                disabled={joining || joinCode.length < 4}
              >
                <LogIn className="h-5 w-5" />
                Join Battle
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Room Created / In-Room View */}
      {inRoom && (
        <div className="space-y-5">
          {/* Room Code Display */}
          {createdRoomCode && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-5">
                <p className="mb-2 text-center text-sm font-medium text-text-secondary">
                  Share this code with your friends
                </p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-4xl font-bold tracking-widest text-primary">
                    {createdRoomCode}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className="rounded-lg bg-primary/10 p-2 text-primary transition-colors hover:bg-primary/20"
                    title="Copy code"
                  >
                    {copied ? (
                      <Check className="h-5 w-5 text-green-600" />
                    ) : (
                      <Copy className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <p className="mt-3 text-center text-xs text-text-secondary">
                  Ask friends to go to Battle Mode and enter this code to join
                </p>
              </CardContent>
            </Card>
          )}

          {/* Joined room (non-host) */}
          {!createdRoomCode && currentRoomCode && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-4 text-center">
                <p className="text-sm text-text-secondary">
                  Joined room{" "}
                  <span className="font-bold tracking-widest text-primary">
                    {currentRoomCode}
                  </span>
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  Waiting for the host to start the game...
                </p>
              </CardContent>
            </Card>
          )}

          {/* Player List */}
          <Card>
            <CardContent className="py-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-text-primary">
                  Players ({players.length})
                </span>
                <span className="ml-auto">
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  <span className="ml-1.5 text-xs text-text-secondary">Live</span>
                </span>
              </div>

              {players.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-text-secondary">
                  <Spinner size="sm" className="mb-2 text-primary" />
                  <p className="text-sm">Waiting for players...</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {players.map((p, i) => (
                    <li
                      key={p.userId}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50"
                    >
                      <span className="w-5 text-center text-sm font-bold text-text-secondary">
                        {i + 1}
                      </span>
                      <Avatar name={p.name} size="sm" />
                      <span className="flex-1 text-sm font-medium text-text-primary">
                        {p.name}
                      </span>
                      {p.userId === hostId && (
                        <Badge variant="warning" className="gap-1">
                          <Crown className="h-3 w-3" />
                          Host
                        </Badge>
                      )}
                      {p.userId === userId && p.userId !== hostId && (
                        <Badge variant="info">You</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Start Button (host only) */}
          {isHost && (
            <Button
              size="lg"
              className="w-full gap-2"
              onClick={handleStartGame}
              isLoading={startingGame}
              disabled={!canStart || startingGame}
            >
              <Play className="h-5 w-5" />
              {players.length < 2 ? "Waiting for players (need 2+ to start)" : "Start Game"}
            </Button>
          )}

          {!isHost && (
            <div className="rounded-lg border border-border bg-gray-50 py-4 text-center text-sm text-text-secondary">
              Waiting for the host to start the game...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
