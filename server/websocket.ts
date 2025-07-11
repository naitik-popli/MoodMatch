import { Server as SocketIOServer, Socket } from "socket.io";
import { MoodQueue } from "@shared/schema";
import { storage } from "./storage";
import { db } from "./db";
import { moodQueue, chatSessions } from "@shared/schema";
import { and, lt, or, eq } from "drizzle-orm";
import { logToFile } from './backend-logs.js';
import type { Mood } from "@shared/schema";
import { pgTable, serial, varchar, integer } from "drizzle-orm/pg-core";

interface SocketData {
  userId?: number;
  mood?: Mood;
  sessionId?: number;
  partnerId?: number;
}

const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const MATCH_INTERVAL = 5000;
const MAX_QUEUE_TIME = 300000;

const userSocketMapTable = pgTable("user_socket_map", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().primaryKey(),
  partnerId: integer("partner_id"),
  socketId: varchar("socket_id", { length: 255 }).notNull(),
});

const userSocketMapDb = db;

// --- User Socket Map helpers ---

export async function setUserSocketMap(userId: number, partnerId: number | null, socketId: string) {
  if (!userId || typeof userId !== "number") throw new Error("userId is required and must be a number");
  if (!socketId || typeof socketId !== "string") throw new Error("socketId is required and must be a string");
  await userSocketMapDb
    .insert(userSocketMapTable)
    .values({ userId, partnerId, socketId })
    .onConflictDoUpdate({
      target: [userSocketMapTable.userId],
      set: { partnerId, socketId }
    });
}

export async function getUserSocketId(userId: number) {
  if (!userId || typeof userId !== "number") return null;
  const result = await userSocketMapDb
    .select()
    .from(userSocketMapTable)
    .where(eq(userSocketMapTable.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0].socketId : null;
}

export async function deleteUserSocketMap(userId: number) {
  if (!userId || typeof userId !== "number") return;
  await userSocketMapDb
    .delete(userSocketMapTable)
    .where(eq(userSocketMapTable.userId, userId));
}

// --- WebSocket Setup ---

export async function setupWebSocket(io: SocketIOServer) {
  console.log("[WS] Initializing WebSocket server");
  logToFile("WebSocket server starting");

  // Helper: get partnerId from DB for a given userId
  async function getPartnerIdFromDb(userId: number): Promise<number | null> {
    try {
      const activeSession = await storage.getActiveSession(userId);
      if (activeSession && activeSession.partnerId !== undefined && activeSession.partnerId !== null) {
        return activeSession.partnerId;
      }
      return null;
    } catch (error) {
      console.error(`[getPartnerIdFromDb] Error fetching active session for user ${userId}:`, error);
      return null;
    }
  }

  // --- Matching Algorithm ---
  const matchUsers = async () => {
    try {
      if (DEBUG_MODE) console.log("[MATCH] Starting matching cycle");
      const queue = await db.select().from(moodQueue).orderBy(moodQueue.createdAt);
      console.log(`[MATCH] Current queue length: ${queue.length}`);
      const moodGroups = new Map<string, typeof queue>();
      for (const user of queue) {
        if (!moodGroups.has(user.mood)) moodGroups.set(user.mood, []);
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
      await db.delete(moodQueue).where(lt(moodQueue.createdAt, cutoffTime));
      console.log(`[MATCH] Cleaned up stale entries older than ${cutoffTime.toISOString()}`);
    } catch (error) {
      console.error("[MATCH] Error:", error);
    }
  };

  const matchingInterval = setInterval(matchUsers, MATCH_INTERVAL);

  io.on("connection", async (socket: Socket) => {
    const connId = socket.id.slice(0, 6);
    console.log(`[CONN ${connId}] New connection [socketId=${socket.id}]`);

    // --- Update Socket ID ---
    socket.on("update-socket-id", async (data: { userId: number; partnerId?: number | null }) => {
      const timestamp = new Date().toISOString();
      if (!data?.userId || typeof data.userId !== "number") {
        console.warn(`[${timestamp}] [SOCKET MAP] update-socket-id called without valid userId`);
        return;
      }
      try {
        const existingSocketId = await getUserSocketId(data.userId);
        if (existingSocketId && existingSocketId !== socket.id) {
          // Optionally disconnect old socket
          // io.sockets.sockets.get(existingSocketId)?.disconnect(true);
          console.log(`[${timestamp}] [SOCKET MAP] Replacing old socket ${existingSocketId} for user ${data.userId}`);
        }
        // Only update if not already set to this socket
        let partnerId: number | null = null;
        partnerId = await getPartnerIdFromDb(data.userId);
        if (partnerId === null) {
          partnerId = data.userId + 1000000;
          console.log(`[${timestamp}] Generated new partnerId ${partnerId} for user ${data.userId}`);
        }
        await setUserSocketMap(data.userId, partnerId, socket.id);
        socket.data.userId = data.userId;
        console.log(`[${timestamp}] [SOCKET MAP] Bound user ${data.userId} to socket ${socket.id} with partnerId ${partnerId}`);
        console.log(`[${timestamp}] [SOCKET MAP] Current userSocketMap entry: userId=${data.userId}, partnerId=${partnerId}, socketId=${socket.id}`);
      } catch (error) {
        console.error(`[${timestamp}] [SOCKET MAP] Error in update-socket-id:`, error);
      }
    });

    // --- Provide socketId to client on request ---
    socket.on("get-socket-id", async (data: { userId: number }) => {
      const timestamp = new Date().toISOString();
      if (!data?.userId || typeof data.userId !== "number") {
        console.warn(`[${timestamp}] [SOCKET MAP] get-socket-id called without valid userId`);
        socket.emit("socket-id-response", { socketId: null });
        return;
      }
      try {
        const socketId = await getUserSocketId(data.userId);
        console.log(`[${timestamp}] [SOCKET MAP] Provided socketId ${socketId} for user ${data.userId}`);
        socket.emit("socket-id-response", { socketId });
      } catch (error) {
        console.error(`[${timestamp}] [SOCKET MAP] Error in get-socket-id:`, error);
        socket.emit("socket-id-response", { socketId: null });
      }
    });

    // --- Handle call end event to clear mapping ---
    socket.on("call-ended", async (data: { userId: number }) => {
      const timestamp = new Date().toISOString();
      if (!data?.userId || typeof data.userId !== "number") {
        console.warn(`[${timestamp}] [SOCKET MAP] call-ended called without valid userId`);
        return;
      }
      try {
        const existingSocketId = await getUserSocketId(data.userId);
        if (existingSocketId === socket.id) {
          await deleteUserSocketMap(data.userId);
          console.log(`[${timestamp}] [CALL END] Removed user ${data.userId} from socket map on call end`);
        }
      } catch (error) {
        console.error(`[${timestamp}] [CALL END] Error in call-ended:`, error);
      }
    });

    // --- Join Mood Queue ---
    socket.on("join-mood-queue", async (data: { userId: number; mood: string }) => {
      try {
        if (!data?.userId || typeof data.userId !== "number" || !data?.mood) {
          throw new Error("Missing or invalid required fields");
        }
        // Prevent duplicate joins
        const existing = await db.select().from(moodQueue).where(eq(moodQueue.userId, data.userId));
        if (existing.length > 0) {
          console.log(`[QUEUE ${data.userId}] Already in queue for mood "${data.mood}"`);
          socket.emit("queue-status", {
            status: "waiting",
            mood: data.mood,
            position: await getQueuePosition(data.userId)
          });
          return;
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
        socket.emit("queue-status", {
          status: "waiting",
          mood: data.mood,
          position
        });
        await matchUsers();
      } catch (error) {
        console.error(`[QUEUE ERROR] ${data?.userId}:`, error);
        socket.emit("queue-error", {
          message: error instanceof Error ? error.message : "Queue join failed"
        });
      }
    });

    // --- Leave Mood Queue ---
    socket.on("leave-mood-queue", async (data: { userId: number }) => {
      try {
        if (!data?.userId || typeof data.userId !== "number") {
          throw new Error("Missing or invalid userId for leave-mood-queue");
        }
        console.log(`[QUEUE ${data.userId}] Leaving queue with socket ${socket.id}`);
        await db.delete(moodQueue).where(eq(moodQueue.userId, data.userId));
        socket.emit("queue-status", {
          status: "left",
          userId: data.userId,
        });
        console.log(`[QUEUE ${data.userId}] Left queue successfully`);
      } catch (error) {
        console.error(`[QUEUE ERROR] ${data?.userId} on leave-mood-queue:`, error);
        socket.emit("queue-error", {
          message: error instanceof Error ? error.message : "Queue leave failed"
        });
      }
    });

    // --- WebRTC Signaling Forwarding ---
    socket.on("webrtc-offer", async (data: any) => {
      const timestamp = new Date().toISOString();
      try {
        if (!data?.targetUserId || typeof data.targetUserId !== "number") {
          throw new Error("Invalid targetUserId for webrtc-offer");
        }
        console.log(`[${timestamp}] [SIGNAL] Received webrtc-offer from ${socket.id} to forward to userId ${data.targetUserId}`, data);
        const targetSocket = await getUserSocketId(data.targetUserId);
        if (targetSocket) {
          io.to(targetSocket).emit("webrtc-offer", {
            fromSocketId: socket.id,
            offer: data.offer,
          });
          console.log(`[${timestamp}] [SIGNAL] Forwarded webrtc-offer from ${socket.id} to socketId ${targetSocket}`);
        } else {
          console.warn(`[${timestamp}] [SIGNAL] Target userId ${data.targetUserId} not found for webrtc-offer`);
        }
      } catch (error) {
        console.error(`[${timestamp}] [SIGNAL] Error in webrtc-offer:`, error);
      }
    });

    socket.on("webrtc-answer", async (data: any) => {
      const timestamp = new Date().toISOString();
      try {
        if (!data?.targetUserId || typeof data.targetUserId !== "number") {
          throw new Error("Invalid targetUserId for webrtc-answer");
        }
        console.log(`[${timestamp}] [SIGNAL] Received webrtc-answer from ${socket.id} to forward to userId ${data.targetUserId}`, data);
        const targetSocket = await getUserSocketId(data.targetUserId);
        if (targetSocket) {
          io.to(targetSocket).emit("webrtc-answer", {
            fromSocketId: socket.id,
            answer: data.answer,
          });
          console.log(`[${timestamp}] [SIGNAL] Forwarded webrtc-answer from ${socket.id} to socketId ${targetSocket}`);
        } else {
          console.warn(`[${timestamp}] [SIGNAL] Target userId ${data.targetUserId} not found for webrtc-answer`);
        }
      } catch (error) {
        console.error(`[${timestamp}] [SIGNAL] Error in webrtc-answer:`, error);
      }
    });

    socket.on("webrtc-ice-candidate", async (data: any) => {
      const timestamp = new Date().toISOString();
      try {
        if (!data?.targetUserId || typeof data.targetUserId !== "number") {
          throw new Error("Invalid targetUserId for webrtc-ice-candidate");
        }
        console.log(`[${timestamp}] [SIGNAL] Received webrtc-ice-candidate from ${socket.id} to forward to userId ${data.targetUserId}`, data);
        const targetSocket = await getUserSocketId(data.targetUserId);
        if (targetSocket) {
          io.to(targetSocket).emit("webrtc-ice-candidate", {
            fromSocketId: socket.id,
            candidate: data.candidate,
          });
          console.log(`[${timestamp}] [SIGNAL] Forwarded webrtc-ice-candidate from ${socket.id} to socketId ${targetSocket}`);
          io.to(targetSocket).emit("test-message", {
            message: "ICE candidate forwarded by server",
            fromSocketId: socket.id,
            candidate: data.candidate,
            timestamp,
          });
        } else {
          console.warn(`[${timestamp}] [SIGNAL] Target userId ${data.targetUserId} not found for webrtc-ice-candidate`);
        }
      } catch (error) {
        console.error(`[${timestamp}] [SIGNAL] Error in webrtc-ice-candidate:`, error);
      }
    });

    // --- Disconnect Handler ---
    socket.on("disconnect", async () => {
      const userId = socket.data?.userId;
      console.log(`[DISCONNECT] Socket ${socket.id} disconnected (userId=${userId})`);
      if (!userId || typeof userId !== "number") return;
      try {
        const existingSocketId = await getUserSocketId(userId);
        if (existingSocketId === socket.id) {
          await deleteUserSocketMap(userId);
          console.log(`[DISCONNECT] Removed user ${userId} from socket map`);
        }
        await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
        console.log(`[DISCONNECT] Removed user ${userId} from queue`);
      } catch (error) {
        console.error(`[DISCONNECT] Error cleaning up user ${userId}:`, error);
      }
    });
  });

  process.on('SIGTERM', () => {
    clearInterval(matchingInterval);
    console.log("[WS] Cleaned up matching interval on shutdown");
  });
}

// --- Helper: Get queue position ---
async function getQueuePosition(userId: number): Promise<number> {
  const queue = await db.select().from(moodQueue).orderBy(moodQueue.createdAt);
  return queue.findIndex(u => u.userId === userId) + 1;
}

// --- Helper: Notify matched pair ---
async function notifyMatchedPair(io: SocketIOServer, userA: number, userB: number, sessionId: number) {
  const socketA = await getUserSocketId(userA);
  const socketB = await getUserSocketId(userB);
  if (!socketA || !socketB) {
    console.warn(`[MATCH] Missing socket for users: A=${socketA}, B=${socketB}`);
    return;
  }
  try {
    let initiatorId = userA;
    let receiverId = userB;
    let initiatorSocket = socketA;
    let receiverSocket = socketB;
    if (userB < userA) {
      initiatorId = userB;
      receiverId = userA;
      initiatorSocket = socketB;
      receiverSocket = socketA;
    }
    io.to(initiatorSocket).emit("match-found", {
      role: "initiator",
      partnerId: receiverId,
      partnerSocketId: receiverSocket,
      sessionId,
      timestamp: new Date().toISOString()
    });
    io.to(receiverSocket).emit("match-found", {
      role: "receiver",
      partnerId: initiatorId,
      partnerSocketId: initiatorSocket,
      sessionId,
      timestamp: new Date().toISOString()
    });
    console.log(`[MATCH] Notified user ${initiatorId} (initiator) and ${receiverId} (receiver) of match (sessionId=${sessionId})`);
  } catch (error) {
    console.error(`[MATCH] Failed to notify users ${userA}/${userB}`, error);
    await Promise.all([
      db.delete(moodQueue).where(eq(moodQueue.userId, userA)),
      db.delete(moodQueue).where(eq(moodQueue.userId, userB))
    ]);
  }
}