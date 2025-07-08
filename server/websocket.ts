import { Server as SocketIOServer, Socket } from "socket.io";
import { MoodQueue } from "@shared/schema";

import { storage } from "./storage";
import { db } from "./db";
import { moodQueue, chatSessions } from "@shared/schema";
import { and, lt, or, eq } from "drizzle-orm";
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

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, varchar, integer } from "drizzle-orm/pg-core";

const userSocketMapTable = pgTable("user_socket_map", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().primaryKey(),
  partnerId: integer("partner_id").notNull(),
  socketId: varchar("socket_id", { length: 255 }).notNull(),
});

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST,
});

const userSocketMapDb = drizzle(pool);

export async function setUserSocketMap(userId: number, partnerId: number, socketId: string) {
  // Upsert logic: insert or update existing record
  const existing = await userSocketMapDb
    .select()
    .from(userSocketMapTable)
    .where(eq(userSocketMapTable.userId, userId));

  if (existing.length > 0) {
    await userSocketMapDb
      .update(userSocketMapTable)
      .set({ partnerId, socketId })
      .where(eq(userSocketMapTable.userId, userId));
  } else {
    await userSocketMapDb
      .insert(userSocketMapTable)
      .values({ userId, partnerId, socketId });
  }
}

export async function getUserSocketId(userId: number) {
  const result = await userSocketMapDb
    .select()
    .from(userSocketMapTable)
    .where(eq(userSocketMapTable.userId, userId))
    .limit(1);

  return result.length > 0 ? result[0].socketId : null;
}

export async function deleteUserSocketMap(userId: number) {
  await userSocketMapDb
    .delete(userSocketMapTable)
    .where(eq(userSocketMapTable.userId, userId));
}

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

          const sessionA = await storage.createChatSession({
            userId: userA.userId,
            mood,
            partnerId: userB.userId,
          });

          const sessionB = await storage.createChatSession({
            userId: userB.userId,
            mood,
            partnerId: userA.userId,
          });

          await notifyMatchedPair(io, userA.userId, userB.userId, sessionA.id);

          await db.delete(moodQueue).where(
            or(eq(moodQueue.userId, userA.userId), eq(moodQueue.userId, userB.userId))
          );

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

  io.on("connection", async (socket: Socket) => {
    const connId = socket.id.slice(0, 6);
    console.log(`[CONN ${connId}] New connection [socketId=${socket.id}]`);

    socket.on("update-socket-id", async (data: { userId: number; partnerId: number }) => {
      const timestamp = new Date().toISOString();
      if (!data?.userId) {
        console.warn(`[${timestamp}] [SOCKET MAP] update-socket-id called without userId`);
        return;
      }
      const existingSocketId = await getUserSocketId(data.userId);
      if (existingSocketId && existingSocketId !== socket.id) {
        // Disconnect the old socket if needed (optional)
        // io.sockets.sockets.get(existingSocketId)?.disconnect(true);
        console.log(`[${timestamp}] [SOCKET MAP] Replacing old socket ${existingSocketId} for user ${data.userId}`);
      }
      await setUserSocketMap(data.userId, data.partnerId, socket.id);
      socket.data.userId = data.userId;
      console.log(`[${timestamp}] [SOCKET MAP] Bound user ${data.userId} to socket ${socket.id}`);
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

    // New handler for leave-mood-queue event
    socket.on("leave-mood-queue", async (data: { userId: number }) => {
      try {
        if (!data?.userId) {
          throw new Error("Missing userId for leave-mood-queue");
        }
        console.log(`[QUEUE ${data.userId}] Leaving queue with socket ${socket.id}`);

        await db.delete(moodQueue).where(eq(moodQueue.userId, data.userId));

        socket.emit("queue-status" as any, {
          status: "left",
          userId: data.userId,
        });

        console.log(`[QUEUE ${data.userId}] Left queue successfully`);
      } catch (error) {
        console.error(`[QUEUE ERROR] ${data?.userId} on leave-mood-queue:`, error);
        socket.emit("queue-error" as any, {
          message: error instanceof Error ? error.message : "Queue leave failed"
        });
      }
    });

    // Forward WebRTC signaling messages with enhanced logging
    socket.on("webrtc-offer", async (data: any) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [SIGNAL] Received webrtc-offer from ${socket.id} to forward to ${data.targetSocketId}`, data);
      const targetSocket = await getUserSocketId(data.targetSocketId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc-offer", {
          fromSocketId: socket.id,
          offer: data.offer,
        });
        console.log(`[${timestamp}] [SIGNAL] Forwarded webrtc-offer from ${socket.id} to ${targetSocket}`);
      } else {
        console.warn(`[${timestamp}] [SIGNAL] Target socket ${data.targetSocketId} not found for webrtc-offer`);
      }
    });

    socket.on("webrtc-answer", async (data: any) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [SIGNAL] Received webrtc-answer from ${socket.id} to forward to ${data.targetSocketId}`, data);
      const targetSocket = await getUserSocketId(data.targetSocketId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc-answer", {
          fromSocketId: socket.id,
          answer: data.answer,
        });
        console.log(`[${timestamp}] [SIGNAL] Forwarded webrtc-answer from ${socket.id} to ${targetSocket}`);
      } else {
        console.warn(`[${timestamp}] [SIGNAL] Target socket ${data.targetSocketId} not found for webrtc-answer`);
      }
    });

    socket.on("webrtc-ice-candidate", async (data: any) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [SIGNAL] Received webrtc-ice-candidate from ${socket.id} to forward to ${data.targetSocketId}`, data);
      const targetSocket = await getUserSocketId(data.targetSocketId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc-ice-candidate", {
          fromSocketId: socket.id,
          candidate: data.candidate,
        });
        console.log(`[${timestamp}] [SIGNAL] Forwarded webrtc-ice-candidate from ${socket.id} to ${targetSocket}`);

        // Forward test message for debugging ICE candidate sending
        io.to(targetSocket).emit("test-message", {
          message: "ICE candidate forwarded by server",
          fromSocketId: socket.id,
          candidate: data.candidate,
          timestamp,
        });
      } else {
        console.warn(`[${timestamp}] [SIGNAL] Target socket ${data.targetSocketId} not found for webrtc-ice-candidate`);
      }
    });

    socket.on("disconnect", async () => {
      const userId = socket.data?.userId;
      console.log(`[DISCONNECT] Socket ${socket.id} disconnected (userId=${userId})`);

      if (!userId) return;

  // Remove user from activeSessions if present
  // Removed activeSessions usage as it is no longer used

  // Remove socket id from userSocketMap
  // Replaced userSocketMap with DB delete
  const existingSocketId = await getUserSocketId(userId);
  if (existingSocketId === socket.id) {
    await deleteUserSocketMap(userId);
    console.log(`[DISCONNECT] Removed user ${userId} from socket map`);
  }

      // Remove user from moodQueue regardless of active session status
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
  const socketA = await getUserSocketId(userA);
  const socketB = await getUserSocketId(userB);

  if (!socketA || !socketB) {
    console.warn(`[MATCH] Missing socket for users: A=${socketA}, B=${socketB}`);
    return;
  }

  try {
    // Removed activeSessions usage as it is no longer used

    io.to(socketA).emit("match-found", {
      partnerId: userB,
      partnerSocketId: socketB,
      sessionId,
      timestamp: new Date().toISOString()
    });

    io.to(socketB).emit("match-found", {
      partnerId: userA,
      partnerSocketId: socketA,
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
