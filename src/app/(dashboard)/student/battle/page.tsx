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
  BookOpen,
  Hash,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
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

const SUBJECTS = ["Biology", "Mathematics", "Physics", "Chemistry", "English"];
const GRADES = [9, 10, 11, 12];
const QUESTION_COUNTS = [5, 10, 15];

export default function BattleLobbyPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("create");

  // Create room state
  const [selectedSubject, setSelectedSubject] = useState<string>("Biology");
  const [selectedGrade, setSelectedGrade] = useState<number>(9);
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [creating, setCreating] = useState(false);
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [startingGame, setStartingGame] = useState(false);

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
        body: JSON.stringify({
          subject: selectedSubject,
          grade: selectedGrade,
          questionCount,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSocketError(data.error || "Failed to create room");
        return;
      }

      questionsRef.current = data.questions;

      // Emit create_room to socket server
      socketRef.current?.emit("create_room", {
        roomCode: data.roomCode,
        hostId: userId,
        hostName: userName,
        questions: data.questions,
      });

      setCreatedRoomCode(data.roomCode);
      setCurrentRoomCode(data.roomCode);
    } catch {
      setSocketError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom() {
    if (!userId || !joinCode.trim()) return;
    const code = joinCode.trim().toUpperCase();

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

      // Join via socket
      socketRef.current?.emit("join_room", {
        roomCode: code,
        userId,
        name: userName,
      });

      setCurrentRoomCode(code);
      setInRoom(true);
      setActiveTab("create"); // Switch to show player list
    } catch {
      setJoinError("Network error. Please try again.");
    } finally {
      setJoining(false);
    }
  }

  function handleStartGame() {
    if (!currentRoomCode || !userId) return;
    setStartingGame(true);
    socketRef.current?.emit("start_game", {
      roomCode: currentRoomCode,
      userId,
    });
  }

  function handleCopyCode() {
    if (!createdRoomCode) return;
    navigator.clipboard.writeText(createdRoomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isHost = userId === hostId;
  const canStart = isHost && players.length >= 1 && roomStatus === "waiting";

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
      {(activeTab === "create" || inRoom) && !inRoom && (
        <div className="space-y-5">
          {/* Subject */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <BookOpen className="h-4 w-4 text-primary" />
              Subject
            </label>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedSubject(s)}
                  className={cn(
                    "rounded-lg border-2 px-4 py-2 text-sm font-medium transition-colors",
                    selectedSubject === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-secondary hover:border-primary/40"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Grade */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Hash className="h-4 w-4 text-primary" />
              Grade
            </label>
            <div className="flex gap-2">
              {GRADES.map((g) => (
                <button
                  key={g}
                  onClick={() => setSelectedGrade(g)}
                  className={cn(
                    "w-14 rounded-lg border-2 py-2.5 text-sm font-semibold transition-colors",
                    selectedGrade === g
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-secondary hover:border-primary/40"
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Question Count */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Hash className="h-4 w-4 text-primary" />
              Questions
            </label>
            <div className="flex gap-2">
              {QUESTION_COUNTS.map((c) => (
                <button
                  key={c}
                  onClick={() => setQuestionCount(c)}
                  className={cn(
                    "w-16 rounded-lg border-2 py-2.5 text-sm font-semibold transition-colors",
                    questionCount === c
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-secondary hover:border-primary/40"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <Button
            size="lg"
            className="w-full gap-2"
            onClick={handleCreateRoom}
            isLoading={creating}
            disabled={creating}
          >
            <Swords className="h-5 w-5" />
            Create Battle Room
          </Button>
        </div>
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
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase().slice(0, 6));
                    setJoinError(null);
                  }}
                  placeholder="Enter 6-character code"
                  maxLength={6}
                  className="w-full rounded-lg border border-border bg-white px-4 py-3 text-center text-2xl font-bold uppercase tracking-widest text-text-primary placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-text-secondary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                disabled={joining || joinCode.length < 6}
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
              {players.length < 2 ? "Start (need 2+ players for full experience)" : "Start Game"}
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
