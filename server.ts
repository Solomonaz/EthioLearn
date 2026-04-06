import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketServer } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { checkBattleAchievements } from "./src/lib/achievements";

const prisma = new PrismaClient();
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

interface PlayerState {
  userId: string;
  name: string;
  score: number;
  answered: number;
  socketId: string;
  correctAnswers: number;
  totalAnswerTimeMs: number;
  disconnectedAt?: number;
  disconnectTimer?: NodeJS.Timeout;
}

interface RoomState {
  roomCode: string;
  hostId: string;
  players: Map<string, PlayerState>;
  questions: Array<{ question: string; options: string[]; correctIndex: number }>;
  currentQuestion: number;
  status: "waiting" | "countdown" | "in_progress" | "finished";
  questionTimer?: NodeJS.Timeout;
  questionStartedAt: number;
  rematchRequesters: Set<string>;
}

function serializePlayers(room: RoomState) {
  return Array.from(room.players.values()).map((p) => ({
    userId: p.userId,
    name: p.name,
    score: p.score,
    answered: p.answered,
    socketId: p.socketId,
    correctAnswers: p.correctAnswers,
    totalAnswerTimeMs: p.totalAnswerTimeMs,
  }));
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    if (parsedUrl.pathname === "/api/admin/games/live" && req.method === "GET") {
      const roomList = Array.from(rooms.values()).map((room) => ({
        roomCode: room.roomCode,
        status: room.status,
        hostId: room.hostId,
        playerCount: room.players.size,
        currentQuestion: room.currentQuestion,
        totalQuestions: room.questions.length,
        players: serializePlayers(room),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rooms: roomList }));
      return;
    }
    handle(req, res, parsedUrl);
  });

  const io = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  const rooms = new Map<string, RoomState>();

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("join_room", ({ roomCode, userId, name }: { roomCode: string; userId: string; name: string }) => {
      const room = rooms.get(roomCode);
      if (!room) { socket.emit("error", { message: "Room not found" }); return; }

      const existing = room.players.get(userId);
      if (existing) {
        // Reconnect within 30-second window — clear penalty timer
        if (existing.disconnectTimer) { clearTimeout(existing.disconnectTimer); existing.disconnectTimer = undefined; }
        existing.disconnectedAt = undefined;
        existing.socketId = socket.id;
        socket.join(roomCode);
        io.to(roomCode).emit("room_updated", { players: serializePlayers(room), status: room.status, hostId: room.hostId });
        io.to(roomCode).emit("player_reconnected", { userId });
        if (room.status === "in_progress" && room.currentQuestion < room.questions.length) {
          const q = room.questions[room.currentQuestion];
          socket.emit("question", { index: room.currentQuestion, total: room.questions.length, question: q.question, options: q.options, timeLimit: 20 });
        }
        return;
      }

      if (room.status !== "waiting") { socket.emit("error", { message: "Game already in progress" }); return; }
      socket.join(roomCode);
      room.players.set(userId, { userId, name, score: 0, answered: 0, socketId: socket.id, correctAnswers: 0, totalAnswerTimeMs: 0 });
      io.to(roomCode).emit("room_updated", { players: serializePlayers(room), status: room.status, hostId: room.hostId });
    });

    socket.on("create_room", ({ roomCode, hostId, hostName, questions }: {
      roomCode: string; hostId: string; hostName: string;
      questions: Array<{ question: string; options: string[]; correctIndex: number }>;
    }) => {
      rooms.set(roomCode, {
        roomCode, hostId,
        players: new Map([[hostId, { userId: hostId, name: hostName, score: 0, answered: 0, socketId: socket.id, correctAnswers: 0, totalAnswerTimeMs: 0 }]]),
        questions, currentQuestion: 0, status: "waiting", questionStartedAt: 0, rematchRequesters: new Set(),
      });
      socket.join(roomCode);
      socket.emit("room_created", { roomCode });
      io.to(roomCode).emit("room_updated", { players: serializePlayers(rooms.get(roomCode)!), status: "waiting", hostId });
    });

    socket.on("start_game", ({ roomCode, userId }: { roomCode: string; userId: string }) => {
      const room = rooms.get(roomCode);
      if (!room || room.hostId !== userId || room.players.size < 1) return;
      room.status = "countdown";
      io.to(roomCode).emit("countdown_start", { seconds: 3 });
      setTimeout(() => { room.status = "in_progress"; room.currentQuestion = 0; sendQuestion(io, rooms, roomCode); }, 3000);
    });

    socket.on("submit_answer", ({ roomCode, userId, questionIndex, answerIndex, timeLeft }: {
      roomCode: string; userId: string; questionIndex: number; answerIndex: number; timeLeft: number;
    }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== "in_progress") return;
      if (questionIndex !== room.currentQuestion) return;
      const player = room.players.get(userId);
      if (!player || player.answered > questionIndex) return;

      const q = room.questions[questionIndex];
      const isCorrect = answerIndex === q.correctIndex;

      // ── Catch-up mechanic: reduce speed bonus for the current score leader ──
      const allPlayers = Array.from(room.players.values());
      const maxScore = Math.max(0, ...allPlayers.map((p) => p.score));
      const isLeader = player.score >= maxScore && maxScore > 0;
      const speedBonus = isCorrect ? Math.round((timeLeft / 20) * 10 * (isLeader ? 0.8 : 1.0)) : 0;
      const pointsEarned = isCorrect ? 10 + speedBonus : 0;

      player.score += pointsEarned;
      player.answered = questionIndex + 1;

      // Track stats for post-game awards
      const timeTakenMs = Math.min(Date.now() - room.questionStartedAt, 20_000);
      if (isCorrect) { player.correctAnswers += 1; player.totalAnswerTimeMs += timeTakenMs; }

      socket.emit("answer_result", { correct: isCorrect, pointsEarned, correctIndex: q.correctIndex, isLeaderPenalty: isLeader && isCorrect });
      io.to(roomCode).emit("scores_updated", { players: serializePlayers(room) });

      const allAnswered = allPlayers.every((p) => p.answered > questionIndex);
      if (allAnswered) advanceQuestion(io, rooms, roomCode);
    });

    // ── Rematch (with New Questions) ──────────────────────────────────────────
    socket.on("request_rematch", async ({ roomCode, userId }: { roomCode: string; userId: string }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== "finished") return;
      room.rematchRequesters.add(userId);
      const votes = room.rematchRequesters.size;
      const total = room.players.size;
      io.to(roomCode).emit("rematch_vote_updated", { votes, total });

      if (votes >= total && total > 0) {
        room.players.forEach((p) => {
          p.score = 0; p.answered = 0; p.correctAnswers = 0; p.totalAnswerTimeMs = 0;
          p.disconnectedAt = undefined;
          if (p.disconnectTimer) { clearTimeout(p.disconnectTimer); p.disconnectTimer = undefined; }
        });

        // ── Fetch new questions from DB for the rematch ──
        try {
          const dbRoom = await prisma.gameRoom.findUnique({ where: { roomCode } });
          if (dbRoom && dbRoom.quizConfig) {
            const config = dbRoom.quizConfig as any;
            const textbookId = config.textbookId;
            const questionCount = config.questionCount || 10;

            const textbook = await prisma.textbook.findUnique({
              where: { id: textbookId },
              include: { chapters: { select: { id: true } } },
            });

            if (textbook && textbook.chapters.length > 0) {
              const chapterIds = textbook.chapters.map((c: any) => c.id);
              const allQuestions = await prisma.question.findMany({
                where: { chapterId: { in: chapterIds }, type: "MCQ" },
              });

              if (allQuestions.length > 0) {
                // Fisher-Yates shuffle
                for (let i = allQuestions.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
                }
                const selected = allQuestions.slice(0, Math.min(questionCount, allQuestions.length));

                room.questions = selected.map((q) => {
                  const normalize = (val: unknown) => {
                    if (typeof val === "string") return val;
                    if (val && typeof val === "object" && "text" in val) return String((val as any).text);
                    return String(val);
                  };

                  const options = (q.options as unknown[]).map(normalize);
                  const normalizedAnswer = normalize(q.correctAnswer as unknown);
                  const correctIndex = options.indexOf(normalizedAnswer);

                  return {
                    question: q.questionText,
                    options,
                    correctIndex: correctIndex >= 0 ? correctIndex : 0,
                  };
                });
              }
            }
          }
        } catch (error) {
          console.error("Error fetching new questions for rematch:", error);
          // Fallback: reshuffle existing questions if DB fails
          const shuffled = [...room.questions];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          room.questions = shuffled;
        }

        room.currentQuestion = 0;
        room.status = "countdown";
        room.rematchRequesters.clear();

        io.to(roomCode).emit("rematch_starting");
        io.to(roomCode).emit("room_updated", { players: serializePlayers(room), status: "countdown", hostId: room.hostId });
        io.to(roomCode).emit("countdown_start", { seconds: 3 });
        setTimeout(() => { room.status = "in_progress"; room.currentQuestion = 0; sendQuestion(io, rooms, roomCode); }, 3000);
      }
    });

    socket.on("spectate_room", ({ roomCode }: { roomCode: string }) => {
      const room = rooms.get(roomCode);
      if (!room) { socket.emit("error", { message: "Room not found" }); return; }
      socket.join(roomCode);
      socket.emit("room_updated", { players: serializePlayers(room), status: room.status, hostId: room.hostId });
      if (room.status === "in_progress" && room.currentQuestion < room.questions.length) {
        const q = room.questions[room.currentQuestion];
        socket.emit("question", { index: room.currentQuestion, total: room.questions.length, question: q.question, options: q.options, timeLimit: 20 });
      }
    });

    socket.on("disconnect", () => {
      rooms.forEach((room, code) => {
        room.players.forEach((player, userId) => {
          if (player.socketId !== socket.id) return;
          if (room.status === "waiting") {
            room.players.delete(userId);
            io.to(code).emit("room_updated", { players: serializePlayers(room), status: room.status, hostId: room.hostId });
          } else if (room.status === "in_progress") {
            // ── 30-second reconnect window ─────────────────────────────────
            player.disconnectedAt = Date.now();
            io.to(code).emit("player_disconnected", { userId, reconnectWindowMs: 30_000 });
            player.disconnectTimer = setTimeout(() => {
              const current = room.players.get(userId);
              if (current && current.disconnectedAt !== undefined) {
                current.score = Math.floor(current.score * 0.5);
                current.disconnectedAt = undefined;
                current.disconnectTimer = undefined;
                io.to(code).emit("scores_updated", { players: serializePlayers(room), penalty: { userId, reason: "disconnect_timeout" } });
              }
            }, 30_000);
          }
        });
      });
    });
  });

  function sendQuestion(io: SocketServer, rooms: Map<string, RoomState>, roomCode: string) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.questionStartedAt = Date.now();
    const q = room.questions[room.currentQuestion];
    io.to(roomCode).emit("question", { index: room.currentQuestion, total: room.questions.length, question: q.question, options: q.options, timeLimit: 20 });
    room.questionTimer = setTimeout(() => advanceQuestion(io, rooms, roomCode), 22_000);
  }

  function advanceQuestion(io: SocketServer, rooms: Map<string, RoomState>, roomCode: string) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.questionTimer) clearTimeout(room.questionTimer);
    room.currentQuestion += 1;

    if (room.currentQuestion >= room.questions.length) {
      room.status = "finished";
      const allPlayers = Array.from(room.players.values());
      const finalScores = [...allPlayers].sort((a, b) => b.score - a.score);

      // MVP: highest accuracy
      let mvpUserId: string | null = null, bestAcc = -1;
      for (const p of allPlayers) {
        if (p.answered > 0) { const acc = p.correctAnswers / p.answered; if (acc > bestAcc) { bestAcc = acc; mvpUserId = p.userId; } }
      }

      // Fastest Finger: lowest avg ms per correct answer
      let fastestFingerUserId: string | null = null, bestAvg = Infinity;
      for (const p of allPlayers) {
        if (p.correctAnswers > 0) { const avg = p.totalAnswerTimeMs / p.correctAnswers; if (avg < bestAvg) { bestAvg = avg; fastestFingerUserId = p.userId; } }
      }

      // Group stats
      const count = allPlayers.length || 1;
      const groupAvgScore = Math.round(allPlayers.reduce((s, p) => s + p.score, 0) / count);
      const groupAvgAccuracy = allPlayers.reduce((s, p) => s + (p.answered > 0 ? p.correctAnswers / p.answered : 0), 0) / count;
      const withCorrect = allPlayers.filter((p) => p.correctAnswers > 0);
      const groupAvgAnswerTimeMs = withCorrect.length > 0
        ? Math.round(withCorrect.reduce((s, p) => s + p.totalAnswerTimeMs / p.correctAnswers, 0) / withCorrect.length)
        : 0;

      io.to(roomCode).emit("game_finished", {
        finalScores: finalScores.map((p) => ({ userId: p.userId, name: p.name, score: p.score, answered: p.answered, socketId: p.socketId, correctAnswers: p.correctAnswers, totalAnswerTimeMs: p.totalAnswerTimeMs })),
        awards: { mvpUserId, fastestFingerUserId },
        groupStats: { avgScore: groupAvgScore, avgAccuracy: groupAvgAccuracy, avgAnswerTimeMs: groupAvgAnswerTimeMs },
      });

      const winner = finalScores[0];
      if (winner) {
        prisma.user.update({ where: { id: winner.userId }, data: { totalPoints: { increment: 150 } } }).catch(console.error);
        prisma.pointLedger.create({ data: { userId: winner.userId, actionType: "BATTLE_WIN", points: 150, description: `Battle win in room ${roomCode}` } }).catch(console.error);
        checkBattleAchievements(winner.userId).catch(console.error);
      }
      finalScores.forEach((player, index) => {
        prisma.gamePlayer.updateMany({ where: { userId: player.userId }, data: { score: player.score, rank: index + 1 } }).catch(console.error);
      });
      setTimeout(() => rooms.delete(roomCode), 30_000);
    } else {
      setTimeout(() => sendQuestion(io, rooms, roomCode), 2000);
    }
  }

  const PORT = process.env.PORT || 3001;
  httpServer.listen(PORT, () => { console.log(`> Ready on http://localhost:${PORT}`); });
});
