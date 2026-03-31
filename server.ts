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
}

interface RoomState {
  roomCode: string;
  hostId: string;
  players: Map<string, PlayerState>;
  questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
  }>;
  currentQuestion: number;
  status: "waiting" | "countdown" | "in_progress" | "finished";
  questionTimer?: NodeJS.Timeout;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  const rooms = new Map<string, RoomState>();

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on(
      "join_room",
      ({ roomCode, userId, name }: { roomCode: string; userId: string; name: string }) => {
        const room = rooms.get(roomCode);
        if (!room) {
          socket.emit("error", { message: "Room not found" });
          return;
        }
        if (room.status !== "waiting") {
          socket.emit("error", { message: "Game already in progress" });
          return;
        }

        socket.join(roomCode);
        room.players.set(userId, {
          userId,
          name,
          score: 0,
          answered: 0,
          socketId: socket.id,
        });

        io.to(roomCode).emit("room_updated", {
          players: Array.from(room.players.values()),
          status: room.status,
          hostId: room.hostId,
        });
      }
    );

    socket.on(
      "create_room",
      ({
        roomCode,
        hostId,
        hostName,
        questions,
      }: {
        roomCode: string;
        hostId: string;
        hostName: string;
        questions: Array<{ question: string; options: string[]; correctIndex: number }>;
      }) => {
        rooms.set(roomCode, {
          roomCode,
          hostId,
          players: new Map([
            [
              hostId,
              {
                userId: hostId,
                name: hostName,
                score: 0,
                answered: 0,
                socketId: socket.id,
              },
            ],
          ]),
          questions,
          currentQuestion: 0,
          status: "waiting",
        });
        socket.join(roomCode);
        socket.emit("room_created", { roomCode });

        // Immediately broadcast room state to host
        io.to(roomCode).emit("room_updated", {
          players: [{ userId: hostId, name: hostName, score: 0, answered: 0, socketId: socket.id }],
          status: "waiting",
          hostId,
        });
      }
    );

    socket.on(
      "start_game",
      ({ roomCode, userId }: { roomCode: string; userId: string }) => {
        const room = rooms.get(roomCode);
        if (!room || room.hostId !== userId) return;
        if (room.players.size < 1) return;

        room.status = "countdown";
        io.to(roomCode).emit("countdown_start", { seconds: 3 });

        setTimeout(() => {
          room.status = "in_progress";
          room.currentQuestion = 0;
          sendQuestion(io, rooms, roomCode);
        }, 3000);
      }
    );

    socket.on(
      "submit_answer",
      ({
        roomCode,
        userId,
        questionIndex,
        answerIndex,
        timeLeft,
      }: {
        roomCode: string;
        userId: string;
        questionIndex: number;
        answerIndex: number;
        timeLeft: number;
      }) => {
        const room = rooms.get(roomCode);
        if (!room || room.status !== "in_progress") return;
        if (questionIndex !== room.currentQuestion) return;

        const player = room.players.get(userId);
        if (!player) return;

        // Prevent double answering
        if (player.answered > questionIndex) return;

        const q = room.questions[questionIndex];
        const isCorrect = answerIndex === q.correctIndex;
        const pointsEarned = isCorrect ? Math.round(10 + (timeLeft / 20) * 10) : 0;

        player.score += pointsEarned;
        player.answered = questionIndex + 1;

        socket.emit("answer_result", {
          correct: isCorrect,
          pointsEarned,
          correctIndex: q.correctIndex,
        });
        io.to(roomCode).emit("scores_updated", {
          players: Array.from(room.players.values()),
        });

        // Check if all players answered this question
        const allAnswered = Array.from(room.players.values()).every(
          (p) => p.answered > questionIndex
        );
        if (allAnswered) {
          advanceQuestion(io, rooms, roomCode);
        }
      }
    );

    socket.on("disconnect", () => {
      rooms.forEach((room, code) => {
        room.players.forEach((player, userId) => {
          if (player.socketId === socket.id) {
            room.players.delete(userId);
            io.to(code).emit("room_updated", {
              players: Array.from(room.players.values()),
              status: room.status,
              hostId: room.hostId,
            });
          }
        });
      });
    });
  });

  function sendQuestion(
    io: SocketServer,
    rooms: Map<string, RoomState>,
    roomCode: string
  ) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const q = room.questions[room.currentQuestion];
    const questionData = {
      index: room.currentQuestion,
      total: room.questions.length,
      question: q.question,
      options: q.options,
      timeLimit: 20,
    };

    io.to(roomCode).emit("question", questionData);

    // Auto-advance after time limit + buffer
    room.questionTimer = setTimeout(() => {
      advanceQuestion(io, rooms, roomCode);
    }, 22000);
  }

  function advanceQuestion(
    io: SocketServer,
    rooms: Map<string, RoomState>,
    roomCode: string
  ) {
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.questionTimer) clearTimeout(room.questionTimer);

    room.currentQuestion += 1;

    if (room.currentQuestion >= room.questions.length) {
      room.status = "finished";
      const finalScores = Array.from(room.players.values()).sort(
        (a, b) => b.score - a.score
      );
      io.to(roomCode).emit("game_finished", { finalScores });

      // Award +150 pts to the winner + update GamePlayer ranks
      const winner = finalScores[0];
      if (winner) {
        prisma.user.update({
          where: { id: winner.userId },
          data: { totalPoints: { increment: 150 } },
        }).catch(console.error);
        prisma.pointLedger.create({
          data: {
            userId: winner.userId,
            actionType: "BATTLE_WIN",
            points: 150,
            description: `Battle win in room ${roomCode}`,
          },
        }).catch(console.error);
        checkBattleAchievements(winner.userId).catch(console.error);
      }

      // Update ranks for all players
      finalScores.forEach((player, index) => {
        prisma.gamePlayer.updateMany({
          where: { userId: player.userId },
          data: { score: player.score, rank: index + 1 },
        }).catch(console.error);
      });

      // Delay cleanup to allow clients to receive the event
      setTimeout(() => rooms.delete(roomCode), 30000);
    } else {
      setTimeout(() => sendQuestion(io, rooms, roomCode), 2000);
    }
  }

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
  });
});
