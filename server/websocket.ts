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

const userSocketMap = new Map<number, string>();
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
        moodGroups.get(user.mood as string)!.push(user);
      }

      for (const [mood, users] of moodGroups) {
        while (users.length >= 2) {
          const userA = users.shift()!;
          const userB = users.shift()!;

          const sessionId = await storage.createChatSession({
            userId: userA.userId,
            mood,
            partnerId: userB.userId,
          });

          await notifyMatchedPair(io, userA.userId, userB.userId, sessionId);

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
      userSocketMap.set(data.userId, socket.id);
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

    socket.on("disconnect", async () => {
      const userId = socket.data?.userId;
      console.log(`[DISCONNECT] Socket ${socket.id} disconnected (userId=${userId})`);

      if (!userId) return;

      if (!activeSessions.has(userId)) {
        await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
        console.log(`[DISCONNECT] Removed user ${userId} from queue`);
      } else {
        console.log(`[DISCONNECT] User ${userId} is in active session, not removed`);
      }
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
  const socketA = userSocketMap.get(userA);
  const socketB = userSocketMap.get(userB);

  if (!socketA || !socketB) {
    console.warn(`[MATCH] Missing socket for users: A=${socketA}, B=${socketB}`);
    return;
  }

  try {
    activeSessions.add(userA);
    activeSessions.add(userB);

    io.to(socketA).emit("match-found", {
      partnerId: userB,
      sessionId,
      timestamp: new Date().toISOString()
    });

    io.to(socketB).emit("match-found", {
      partnerId: userA,
      sessionId,
      timestamp: new Date().toISOString()
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
