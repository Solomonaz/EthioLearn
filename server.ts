import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketServer } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { decode } from "next-auth/jwt";
import { checkBattleAchievements } from "./src/lib/achievements";
import { getBattleSeconds } from "./src/lib/quiz-timing";

// ── Fun facts pool (SRS §4.6.3) ──────────────────────────────────────────────
const FUN_FACTS: Record<string, string[]> = {
  Biology: [
    "The human body contains about 37 trillion cells.",
    "DNA from a single human cell, if uncoiled, would stretch about 2 meters.",
    "The heart beats approximately 100,000 times per day.",
    "Mitochondria have their own DNA, separate from the cell's nucleus.",
    "Humans share about 98.7% of their DNA with chimpanzees.",
  ],
  Chemistry: [
    "Water is the only substance that naturally exists in all three states on Earth.",
    "Gold is so non-reactive it can be found in its pure form in nature.",
    "A single teaspoon of honey represents the lifetime work of 12 bees.",
    "Oxygen was discovered independently by three scientists in the 1770s.",
    "The human body is about 60% water by mass.",
  ],
  Mathematics: [
    "Zero is the only number that cannot be represented in Roman numerals.",
    "A 'googol' is 10 to the power of 100 — more than atoms in the observable universe.",
    "Pi has been calculated to over 100 trillion decimal places.",
    "The Fibonacci sequence appears in sunflower seeds, pinecones, and nautilus shells.",
    "There are more possible chess games than atoms in the observable universe.",
  ],
  Physics: [
    "Light travels at about 299,792 km/s — fast enough to circle Earth 7.5 times per second.",
    "A neutron star is so dense that a teaspoon of it would weigh a billion tonnes.",
    "Sound travels about 4 times faster in water than in air.",
    "The Milky Way galaxy is about 100,000 light-years across.",
    "Every atom in your body was forged inside a star billions of years ago.",
  ],
  History: [
    "Ethiopia is one of the oldest nations in the world, with a history spanning over 3,000 years.",
    "The Battle of Adwa in 1896 made Ethiopia the first African nation to defeat a European colonial power.",
    "Axum was one of the most powerful ancient empires and the first sub-Saharan African state to mint coins.",
    "The Blue Nile, source of most of the Nile's water, originates at Lake Tana in Ethiopia.",
    "Lalibela's rock-hewn churches, carved in the 12th century, are a UNESCO World Heritage Site.",
  ],
  default: [
    "The average person takes about 6,000–8,000 steps per day.",
    "Honey never spoils — archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible.",
    "A day on Venus is longer than a year on Venus.",
    "Bananas are slightly radioactive due to their potassium content.",
    "Sharks are older than trees — they've existed for over 450 million years.",
  ],
};

function getFunFact(subject?: string): string {
  const pool = (subject && FUN_FACTS[subject]) ? FUN_FACTS[subject] : FUN_FACTS.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

function parseCookies(cookieHeader: string): Record<string, string> {
  return cookieHeader.split(";").reduce((acc, pair) => {
    const [key, ...val] = pair.trim().split("=");
    if (key) acc[key.trim()] = decodeURIComponent(val.join("=").trim());
    return acc;
  }, {} as Record<string, string>);
}

function getSessionToken(cookieHeader: string): string | null {
  const cookies = parseCookies(cookieHeader);
  return (
    cookies["next-auth.session-token"] ??
    cookies["__Secure-next-auth.session-token"] ??
    null
  );
}

async function verifyAdminToken(cookieHeader: string): Promise<boolean> {
  try {
    const rawToken = getSessionToken(cookieHeader);
    if (!rawToken) return false;
    const token = await decode({ token: rawToken, secret: process.env.NEXTAUTH_SECRET! });
    return !!token && ["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(String(token.role ?? ""));
  } catch {
    return false;
  }
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
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
  streak: number;
  bestStreak: number;
  disconnectedAt?: number;
  disconnectTimer?: NodeJS.Timeout;
}

interface RoomState {
  gameRoomId: string;
  roomCode: string;
  hostId: string;
  players: Map<string, PlayerState>;
  questions: Array<{ question: string; options: string[]; correctIndex: number }>;
  currentQuestion: number;
  status: "waiting" | "countdown" | "in_progress" | "finished";
  questionTimer?: NodeJS.Timeout;
  startTimer?: NodeJS.Timeout;
  nextQuestionTimer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
  questionStartedAt: number;
  currentTimeLimit?: number; // seconds allotted to the current question
  rematchRequesters: Set<string>;
  subject?: string; // for fun facts
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
    streak: p.streak,
    bestStreak: p.bestStreak,
  }));
}

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    const parsedUrl = parse(req.url!, true);
    if (parsedUrl.pathname === "/api/admin/games/live" && req.method === "GET") {
      const isAdmin = await verifyAdminToken(req.headers.cookie ?? "");
      if (!isAdmin) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const roomList = Array.from(rooms.values()).map((room) => ({
        roomCode: room.roomCode,
        status: room.status,
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

  const allowedOrigins = process.env.NEXTAUTH_URL
    ? [process.env.NEXTAUTH_URL.replace(/\/$/, "")]
    : ["http://localhost:3001"];

  const io = new SocketServer(httpServer, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
  });

  // ── Socket.io auth middleware ─────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie ?? "";
      const rawToken = getSessionToken(cookieHeader);
      if (!rawToken) return next(new Error("Authentication required"));

      const token = await decode({ token: rawToken, secret: process.env.NEXTAUTH_SECRET! });
      if (!token?.id) return next(new Error("Authentication required"));

      // Session revocation check — reject if session was signed out elsewhere
      if (token.sessionId) {
        const session = await prisma.userSession.findUnique({
          where: { sessionId: token.sessionId as string },
          select: { isRevoked: true, expiresAt: true },
        });
        if (!session || session.isRevoked || session.expiresAt < new Date()) {
          return next(new Error("Session revoked"));
        }
      }

      socket.data.userId = String(token.id);
      socket.data.role = String(token.role ?? "STUDENT");
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  const rooms = new Map<string, RoomState>();

  io.on("connection", (socket) => {
    if (dev) console.log("Socket connected:", socket.id, "user:", socket.data.userId);

    socket.on("join_room", ({ roomCode, name }: { roomCode: string; name: string }) => {
      const userId = socket.data.userId as string;
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
          const timeLimit = room.currentTimeLimit ?? getBattleSeconds({ questionText: q.question, options: q.options });
          const elapsedSec = Math.floor((Date.now() - room.questionStartedAt) / 1000);
          const remainingTime = Math.max(1, timeLimit - elapsedSec);
          const hasAnswered = existing.answered > room.currentQuestion;

          socket.emit("question", {
            index: room.currentQuestion,
            total: room.questions.length,
            question: q.question,
            options: q.options,
            timeLimit,
            remainingTime,
            questionStartedAt: room.questionStartedAt,
            hasAnswered,
          });
        }
        return;
      }

      if (room.status !== "waiting") { socket.emit("error", { message: "Game already in progress" }); return; }
      socket.join(roomCode);
      room.players.set(userId, { userId, name, score: 0, answered: 0, socketId: socket.id, correctAnswers: 0, totalAnswerTimeMs: 0, streak: 0, bestStreak: 0 });
      if (room.gameRoomId) {
        prisma.gamePlayer.upsert({
          where: { userId_gameRoomId: { userId, gameRoomId: room.gameRoomId } },
          create: { userId, gameRoomId: room.gameRoomId, score: 0 },
          update: {},
        }).catch(console.error);
      }
      io.to(roomCode).emit("room_updated", { players: serializePlayers(room), status: room.status, hostId: room.hostId });
    });

    socket.on("create_room", async ({ roomCode, hostName }: {
      roomCode: string; hostName: string;
      questions?: unknown; // Client may still send these — they are ignored
    }) => {
      const hostId = socket.data.userId as string;

      try {
        // Load questions from DB (server-authoritative — never trust client)
        const dbRoom = await prisma.gameRoom.findUnique({ where: { roomCode } });
        if (!dbRoom?.quizConfig) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        // Verify the requesting user is the room host
        if (dbRoom.hostUserId !== hostId) {
          socket.emit("error", { message: "Only the host can initialize the room" });
          return;
        }

        const config = dbRoom.quizConfig as any;
        const questions = config.questions as Array<{ question: string; options: string[]; correctIndex: number }>;
        if (!questions?.length) {
          socket.emit("error", { message: "No questions available" });
          return;
        }

        rooms.set(roomCode, {
          gameRoomId: dbRoom.id,
          roomCode, hostId,
          players: new Map([[hostId, { userId: hostId, name: hostName, score: 0, answered: 0, socketId: socket.id, correctAnswers: 0, totalAnswerTimeMs: 0, streak: 0, bestStreak: 0 }]]),
          questions, currentQuestion: 0, status: "waiting", questionStartedAt: 0, rematchRequesters: new Set(),
          subject: config.subject ?? undefined,
        });
        socket.join(roomCode);
        socket.emit("room_created", { roomCode });
        io.to(roomCode).emit("room_updated", { players: serializePlayers(rooms.get(roomCode)!), status: "waiting", hostId });
      } catch (err) {
        console.error("Error creating room:", err);
        socket.emit("error", { message: "Failed to create room" });
      }
    });

    socket.on("start_game", ({ roomCode }: { roomCode: string }) => {
      const userId = socket.data.userId as string;
      const room = rooms.get(roomCode);
      if (!room || room.hostId !== userId) return;
      if (room.players.size < 2) {
        socket.emit("error", { message: "At least 2 players are required to start a battle." });
        return;
      }
      if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = undefined; }
      if (room.questionTimer) { clearTimeout(room.questionTimer); room.questionTimer = undefined; }
      if (room.startTimer) { clearTimeout(room.startTimer); room.startTimer = undefined; }
      if (room.nextQuestionTimer) { clearTimeout(room.nextQuestionTimer); room.nextQuestionTimer = undefined; }

      room.status = "countdown";
      if (room.gameRoomId) {
        prisma.gameRoom.update({
          where: { id: room.gameRoomId },
          data: { status: "ACTIVE" },
        }).catch(console.error);
      }
      io.to(roomCode).emit("countdown_start", { seconds: 3 });
      room.startTimer = setTimeout(() => { room.status = "in_progress"; room.currentQuestion = 0; sendQuestion(io, rooms, roomCode); }, 3000);
    });

    socket.on("submit_answer", ({ roomCode, questionIndex, answerIndex, timeLeft, timeTakenMs }: {
      roomCode: string; questionIndex: number; answerIndex: number; timeLeft?: number; timeTakenMs?: number;
    }) => {
      const userId = socket.data.userId as string;
      const room = rooms.get(roomCode);
      if (!room || room.status !== "in_progress") return;
      if (questionIndex !== room.currentQuestion) return;
      const player = room.players.get(userId);
      if (!player || player.answered > questionIndex) return;

      const q = room.questions[questionIndex];
      const isCorrect = answerIndex === q.correctIndex;

      // ── Streak Tracking & Bonus ──
      // Consecutive correct answers award bonus points:
      // 3 in a row = 10%, 4 in a row = 15%, 5 in a row = 20%, +5% for each additional.
      let streakBonusPct = 0;
      if (isCorrect) {
        player.streak = (player.streak || 0) + 1;
        if (player.streak > (player.bestStreak || 0)) {
          player.bestStreak = player.streak;
        }
        if (player.streak >= 3) {
          streakBonusPct = 10 + (player.streak - 3) * 5;
        }
      } else {
        player.streak = 0;
      }

      // ── Millisecond-Precision Scoring (Kahoot-Style, Out of 100) ──
      const timeBudgetSec = room.currentTimeLimit ?? 20;
      const timeBudgetMs = timeBudgetSec * 1000;
      const serverElapsedMs = Math.max(0, Date.now() - room.questionStartedAt);

      // Fair millisecond calculation with latency tolerance and anti-cheat bounding
      let effectiveTimeTakenMs = serverElapsedMs;
      if (typeof timeTakenMs === "number" && !isNaN(timeTakenMs) && timeTakenMs >= 0) {
        const minAllowed = Math.max(0, serverElapsedMs - 1500);
        const maxAllowed = Math.min(serverElapsedMs + 500, timeBudgetMs);
        effectiveTimeTakenMs = Math.min(Math.max(Math.round(timeTakenMs), minAllowed), maxAllowed);
      } else if (typeof timeLeft === "number" && !isNaN(timeLeft)) {
        effectiveTimeTakenMs = Math.min(Math.max(0, (timeBudgetSec - timeLeft) * 1000), timeBudgetMs);
      }
      effectiveTimeTakenMs = Math.min(effectiveTimeTakenMs, timeBudgetMs);

      // Remaining time in milliseconds (0 to timeBudgetMs)
      const timeLeftMs = Math.max(0, timeBudgetMs - effectiveTimeTakenMs);

      // Kahoot-style scoring out of 100 points:
      // Base: 50 points for correct answer
      // Speed bonus: up to 50 points based on exact remaining milliseconds
      const basePoints = isCorrect ? 50 : 0;
      const speedBonus = isCorrect && timeBudgetMs > 0
        ? Math.round((timeLeftMs / timeBudgetMs) * 50)
        : 0;
      const rawPoints = basePoints + speedBonus;

      // Streak bonus percentage on top
      const streakBonusPoints = isCorrect && streakBonusPct > 0
        ? Math.round(rawPoints * (streakBonusPct / 100))
        : 0;
      const pointsEarned = rawPoints + streakBonusPoints;

      player.score += pointsEarned;
      player.answered = questionIndex + 1;

      // Track stats for post-game awards (using millisecond accuracy)
      if (isCorrect) {
        player.correctAnswers += 1;
        player.totalAnswerTimeMs += effectiveTimeTakenMs;
      }

      socket.emit("answer_result", {
        correct: isCorrect,
        pointsEarned,
        correctIndex: q.correctIndex,
        streak: player.streak,
        streakBonusPct,
        timeTakenMs: effectiveTimeTakenMs,
      });
      io.to(roomCode).emit("scores_updated", { players: serializePlayers(room) });

      const allPlayers = Array.from(room.players.values());
      const allAnswered = allPlayers.every((p) => p.answered > questionIndex);
      if (allAnswered) advanceQuestion(io, rooms, roomCode);
    });

    // ── Rematch (with New Questions) ──────────────────────────────────────────
    socket.on("request_rematch", async ({ roomCode }: { roomCode: string }) => {
      const userId = socket.data.userId as string;
      const room = rooms.get(roomCode);
      if (!room || room.status !== "finished") return;

      // Cancel room cleanup timer as soon as any player expresses intent to rematch
      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = undefined;
      }

      room.rematchRequesters.add(userId);
      const votes = room.rematchRequesters.size;
      const total = room.players.size;
      io.to(roomCode).emit("rematch_vote_updated", { votes, total });

      if (votes >= total && total >= 2) {
        if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = undefined; }
        if (room.questionTimer) { clearTimeout(room.questionTimer); room.questionTimer = undefined; }
        if (room.startTimer) { clearTimeout(room.startTimer); room.startTimer = undefined; }
        if (room.nextQuestionTimer) { clearTimeout(room.nextQuestionTimer); room.nextQuestionTimer = undefined; }

        room.players.forEach((p) => {
          p.score = 0; p.answered = 0; p.correctAnswers = 0; p.totalAnswerTimeMs = 0;
          p.streak = 0; p.bestStreak = 0;
          p.disconnectedAt = undefined;
          if (p.disconnectTimer) { clearTimeout(p.disconnectTimer); p.disconnectTimer = undefined; }
        });

        // ── Fetch new questions from DB for the rematch ──
        let newQuestionsLoaded = false;
        try {
          const dbRoom = await prisma.gameRoom.findUnique({ where: { roomCode } });
          if (dbRoom && dbRoom.quizConfig) {
            const config = dbRoom.quizConfig as any;
            const textbookId = config.textbookId;
            const questionCount = config.questionCount || 10;

            if (textbookId) {
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

                  const normalize = (val: unknown) => {
                    if (typeof val === "string") return val;
                    if (val && typeof val === "object" && "text" in val) return String((val as any).text);
                    return String(val);
                  };

                  room.questions = selected.map((q) => {
                    const options = (q.options as unknown[]).map(normalize);
                    const normalizedAnswer = normalize(q.correctAnswer as unknown);
                    const correctIndex = options.indexOf(normalizedAnswer);

                    return {
                      question: q.questionText,
                      options,
                      correctIndex: correctIndex >= 0 ? correctIndex : 0,
                    };
                  });
                  newQuestionsLoaded = true;
                }
              }
            }
          }
        } catch (error) {
          console.error("Error fetching new questions for rematch:", error);
        }

        // Fallback: reshuffle existing questions if new questions could not be loaded from DB
        if (!newQuestionsLoaded && room.questions && room.questions.length > 0) {
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
        if (room.gameRoomId) {
          prisma.gameRoom.update({
            where: { id: room.gameRoomId },
            data: { status: "ACTIVE" },
          }).catch(console.error);
        }

        io.to(roomCode).emit("rematch_starting");
        io.to(roomCode).emit("room_updated", { players: serializePlayers(room), status: "countdown", hostId: room.hostId });
        io.to(roomCode).emit("countdown_start", { seconds: 3 });
        room.startTimer = setTimeout(() => { room.status = "in_progress"; room.currentQuestion = 0; sendQuestion(io, rooms, roomCode); }, 3000);
      }
    });

    socket.on("spectate_room", ({ roomCode }: { roomCode: string }) => {
      const room = rooms.get(roomCode);
      if (!room) { socket.emit("error", { message: "Room not found" }); return; }
      socket.join(roomCode);
      socket.emit("room_updated", { players: serializePlayers(room), status: room.status, hostId: room.hostId });
      if (room.status === "in_progress" && room.currentQuestion < room.questions.length) {
        const q = room.questions[room.currentQuestion];
        const timeLimit = room.currentTimeLimit ?? getBattleSeconds({ questionText: q.question, options: q.options });
        const elapsedSec = Math.floor((Date.now() - room.questionStartedAt) / 1000);
        const remainingTime = Math.max(1, timeLimit - elapsedSec);
        socket.emit("question", {
          index: room.currentQuestion,
          total: room.questions.length,
          question: q.question,
          options: q.options,
          timeLimit,
          remainingTime,
          questionStartedAt: room.questionStartedAt,
        });
      }
    });

    socket.on("disconnect", () => {
      rooms.forEach((room, code) => {
        room.players.forEach((player, userId) => {
          if (player.socketId !== socket.id) return;
          if (room.status === "waiting") {
            room.players.delete(userId);
            if (room.gameRoomId && userId !== room.hostId) {
              prisma.gamePlayer.deleteMany({
                where: { userId, gameRoomId: room.gameRoomId },
              }).catch(console.error);
            }
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
    if (room.questionTimer) clearTimeout(room.questionTimer);
    if (room.nextQuestionTimer) clearTimeout(room.nextQuestionTimer);
    room.questionStartedAt = Date.now();
    const q = room.questions[room.currentQuestion];
    // Heavy calculation/graph questions get a longer window; normal ones keep 20 s.
    const timeLimit = getBattleSeconds({ questionText: q.question, options: q.options });
    room.currentTimeLimit = timeLimit;
    io.to(roomCode).emit("question", {
      index: room.currentQuestion,
      total: room.questions.length,
      question: q.question,
      options: q.options,
      timeLimit,
      remainingTime: timeLimit,
      questionStartedAt: room.questionStartedAt,
    });
    room.questionTimer = setTimeout(() => advanceQuestion(io, rooms, roomCode), (timeLimit + 2) * 1000);
  }

  function advanceQuestion(io: SocketServer, rooms: Map<string, RoomState>, roomCode: string) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.questionTimer) {
      clearTimeout(room.questionTimer);
      room.questionTimer = undefined;
    }
    if (room.nextQuestionTimer) {
      clearTimeout(room.nextQuestionTimer);
      room.nextQuestionTimer = undefined;
    }
    const prevIndex = room.currentQuestion;
    room.currentQuestion += 1;

    // Reset streak for any player who timed out without answering
    room.players.forEach((p) => {
      if (p.answered <= prevIndex) {
        p.streak = 0;
      }
    });

    if (room.currentQuestion >= room.questions.length) {
      // Emit final fun fact before showing results
      io.to(roomCode).emit("fun_fact", { fact: getFunFact(room.subject) });
      room.status = "finished";
      if (room.gameRoomId) {
        prisma.gameRoom.update({
          where: { id: room.gameRoomId },
          data: { status: "COMPLETED" },
        }).catch(console.error);
      }
      const allPlayers = Array.from(room.players.values());
      const finalScores = [...allPlayers].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.totalAnswerTimeMs - b.totalAnswerTimeMs;
      });

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
        finalScores: finalScores.map((p) => ({
          userId: p.userId,
          name: p.name,
          score: p.score,
          answered: p.answered,
          socketId: p.socketId,
          correctAnswers: p.correctAnswers,
          totalAnswerTimeMs: p.totalAnswerTimeMs,
          streak: p.streak,
          bestStreak: p.bestStreak,
        })),
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
        if (room.gameRoomId) {
          prisma.gamePlayer.upsert({
            where: { userId_gameRoomId: { userId: player.userId, gameRoomId: room.gameRoomId } },
            create: { userId: player.userId, gameRoomId: room.gameRoomId, score: player.score, rank: index + 1 },
            update: { score: player.score, rank: index + 1 },
          }).catch(console.error);
        }
      });

      // Clear any prior cleanup timer and schedule a guarded 5-minute cleanup
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      room.cleanupTimer = setTimeout(() => {
        const current = rooms.get(roomCode);
        if (current && current.status === "finished") {
          rooms.delete(roomCode);
        }
      }, 5 * 60 * 1000);
    } else {
      // Emit a fun fact between questions (SRS §4.6.3)
      io.to(roomCode).emit("fun_fact", { fact: getFunFact(room.subject) });
      room.nextQuestionTimer = setTimeout(() => sendQuestion(io, rooms, roomCode), 2500);
    }
  }

  const PORT = process.env.PORT || 3001;
  httpServer.listen(PORT, () => { console.log(`> Ready on http://localhost:${PORT}`); });
});
