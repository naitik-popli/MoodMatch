import { Server as SocketIOServer, Socket } from "socket.io";
import { storage } from "./storage";
import { db } from "./db";
import { moodQueue, chatSessions } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { logToFile } from './backend-logs.js';
import type { Mood } from "@shared/schema";

interface SocketData {
  userId?: number;
  mood?: Mood;
  sessionId?: number;
  partnerId?: number;
}

const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const MATCH_INTERVAL = 5000;
const MAX_QUEUE_TIME = 300000;

const userSocketMap = new Map<number, Set<string>>();
const activeSessions = new Set<number>();

export async function setupWebSocket(io: SocketIOServer) {
  console.log("[WS] Initializing WebSocket server");
  logToFile("WebSocket server starting");

  // Matching algorithm
  const matchUsers = async () => {
    try {
      if (DEBUG_MODE) console.log("[MATCH] Starting matching cycle");

      const queue = await db.select().from(moodQueue).orderBy(moodQueue.createdAt);

      console.log(`[MATCH] Current queue length: ${queue.length}`);
  const moodGroups = new Map<string, typeof queue>();

  for (const user of queue) {
    if (!moodGroups.has(user.mood)) {
      moodGroups.set(user.mood, []);
    }
    // Use Array.prototype.push.apply to avoid TS downlevelIteration error
    Array.prototype.push.apply(moodGroups.get(user.mood as string)!, [user]);
  }

      for (const [mood, users] of moodGroups) {
        while (users.length >= 2) {
          const userA = users.shift()!;
          const userB = users.shift()!;

          const session = await storage.createChatSession({
            userId: userA.userId,
            mood,
            partnerId: userB.userId,
          });

          await notifyMatchedPair(io, userA.userId, userB.userId, session.id);

          await Promise.all([
            db.delete(moodQueue).where(eq(moodQueue.userId, userA.userId)),
            db.delete(moodQueue).where(eq(moodQueue.userId, userB.userId))
          ]);

          console.log(`[MATCH] Paired users ${userA.userId} and ${userB.userId} in mood "${mood}"`);
        }
      }

      // Cleanup stale entries
      const cutoffTime = new Date(Date.now() - MAX_QUEUE_TIME);
      const stale = await db.delete(moodQueue)
        .where(lt(moodQueue.createdAt, cutoffTime));
      console.log(`[MATCH] Cleaned up stale entries older than ${cutoffTime.toISOString()}`);

    } catch (error) {
      console.error("[MATCH] Error:", error);
    }
  };

  const matchingInterval = setInterval(matchUsers, MATCH_INTERVAL);

  io.on("connection", async (socket: Socket<{}, {}, {}, SocketData>) => {
    const connId = socket.id.slice(0, 6);
    console.log(`[CONN ${connId}] New connection [socketId=${socket.id}]`);

    socket.on("update-socket-id", (data: { userId: number }) => {
      if (!data?.userId) return;
      let sockets = userSocketMap.get(data.userId);
      if (!sockets) {
        sockets = new Set();
        userSocketMap.set(data.userId, sockets);
      }
      sockets.add(socket.id);
      socket.data.userId = data.userId;
      console.log(`[SOCKET MAP] Bound user ${data.userId} to socket ${socket.id}`);
    });

    socket.on("join-mood-queue", async (data: { userId: number; mood: string }) => {
      try {
        if (!data?.userId || !data?.mood) {
          throw new Error("Missing required fields");
        }

        console.log(`[QUEUE ${data.userId}] Attempting to join queue for "${data.mood}" with socket ${socket.id}`);

        await db.transaction(async (tx) => {
          await tx.delete(moodQueue).where(eq(moodQueue.userId, data.userId));

          await tx.insert(moodQueue).values({
            userId: data.userId,
            mood: data.mood,
            socketId: socket.id,
            createdAt: new Date()
          });
        });

        const position = await getQueuePosition(data.userId);
        console.log(`[QUEUE ${data.userId}] Joined queue at position ${position} for mood "${data.mood}"`);

        socket.emit("queue-status" as any, {
          status: "waiting",
          mood: data.mood,
          position
        });

        await matchUsers();

      } catch (error) {
        console.error(`[QUEUE ERROR] ${data?.userId}:`, error);
        socket.emit("queue-error" as any, {
          message: error instanceof Error ? error.message : "Queue join failed"
        });
      }
    });

    // Forward WebRTC signaling messages
    socket.on("webrtc-offer", (data: any) => {
      const targetSocket = userSocketMap.get(data.targetSocketId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc-offer", {
          fromSocketId: socket.id,
          offer: data.offer,
        });
        console.log(`[SIGNAL] Forwarded webrtc-offer from ${socket.id} to ${targetSocket}`);
      }
    });

    socket.on("webrtc-answer", (data: any) => {
      const targetSocket = userSocketMap.get(data.targetSocketId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc-answer", {
          fromSocketId: socket.id,
          answer: data.answer,
        });
        console.log(`[SIGNAL] Forwarded webrtc-answer from ${socket.id} to ${targetSocket}`);
      }
    });

    socket.on("webrtc-ice-candidate", (data: any) => {
      const targetSocket = userSocketMap.get(data.targetSocketId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc-ice-candidate", {
          fromSocketId: socket.id,
          candidate: data.candidate,
        });
        console.log(`[SIGNAL] Forwarded webrtc-ice-candidate from ${socket.id} to ${targetSocket}`);
      }
    });

  socket.on("disconnect", async () => {
      const userId = socket.data?.userId;
      console.log(`[DISCONNECT] Socket ${socket.id} disconnected (userId=${userId})`);

      if (!userId) return;

      // Remove user from activeSessions if present
      if (activeSessions.has(userId)) {
        activeSessions.delete(userId);
        console.log(`[DISCONNECT] Removed user ${userId} from active sessions`);
      }

      // Remove socket id from userSocketMap
      const sockets = userSocketMap.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        console.log(`[DISCONNECT] Removed socket ${socket.id} from user ${userId} socket map`);
        if (sockets.size === 0) {
          userSocketMap.delete(userId);
          console.log(`[DISCONNECT] Removed user ${userId} from socket map`);
        }
      }

      // Remove user from moodQueue
      await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
      console.log(`[DISCONNECT] Removed user ${userId} from queue`);
    });
  });

  process.on('SIGTERM', () => {
    clearInterval(matchingInterval);
    console.log("[WS] Cleaned up matching interval on shutdown");
  });
}

async function getQueuePosition(userId: number): Promise<number> {
  const queue = await db.select().from(moodQueue).orderBy(moodQueue.createdAt);
  return queue.findIndex(u => u.userId === userId) + 1;
}

async function notifyMatchedPair(io: SocketIOServer, userA: number, userB: number, sessionId: number) {
  const socketsA = userSocketMap.get(userA);
  const socketsB = userSocketMap.get(userB);

  if (!socketsA || !socketsB) {
    console.warn(`[MATCH] Missing socket for users: A=${socketsA}, B=${socketsB}`);
    return;
  }

  try {
    activeSessions.add(userA);
    activeSessions.add(userB);

    socketsA.forEach(socketId => {
      io.to(socketId).emit("match-found", {
        partnerId: userB,
        partnerSocketId: Array.from(socketsB)[0], // send one socketId of partner
        sessionId,
        timestamp: new Date().toISOString()
      });
    });

    socketsB.forEach(socketId => {
      io.to(socketId).emit("match-found", {
        partnerId: userA,
        partnerSocketId: Array.from(socketsA)[0], // send one socketId of partner
        sessionId,
        timestamp: new Date().toISOString()
      });
    });

    console.log(`[MATCH] Notified user ${userA} and ${userB} of match (sessionId=${sessionId})`);
  } catch (error) {
    console.error(`[MATCH] Failed to notify users ${userA}/${userB}`, error);
    await Promise.all([
      db.delete(moodQueue).where(eq(moodQueue.userId, userA)),
      db.delete(moodQueue).where(eq(moodQueue.userId, userB))
    ]);
  }
}
