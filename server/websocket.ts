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

export async function setUserSocketMap(userId: number, partnerId: number | null, socketId: string) {
  if (!userId) throw new Error("userId is required");
  if (!socketId) throw new Error("socketId is required");

  await userSocketMapDb
    .insert(userSocketMapTable)
    .values({ userId, partnerId, socketId })
    .onConflictDoUpdate({
      target: [userSocketMapTable.userId],
      set: { partnerId, socketId }
    });
}
  // partnerId can be null

  // Upsert logic: insert or update existing record
//   const existing = await userSocketMapDb
//     .select()
//     .from(userSocketMapTable)
//     .where(eq(userSocketMapTable.userId, userId));

//   if (existing.length > 0) {
//     await userSocketMapDb
//       .update(userSocketMapTable)
//       .set({ partnerId, socketId })
//       .where(eq(userSocketMapTable.userId, userId));
//   } else {
//     await userSocketMapDb
//       .insert(userSocketMapTable)
//       .values({ userId, partnerId, socketId });
//   }
// }

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

  // Helper function to get partnerId from database for a given userId
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

    socket.on("update-socket-id", async (data: { userId: number; partnerId?: number | null }) => {
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
      // Get or generate partnerId from database or create new
      let partnerId: number | null = null;
      try {
        partnerId = await getPartnerIdFromDb(data.userId);
        if (partnerId === null) {
          // No active session, generate new partnerId (e.g., use userId + offset or UUID)
          partnerId = data.userId + 1000000; // Example: offset userId to create unique partnerId
          console.log(`[${timestamp}] Generated new partnerId ${partnerId} for user ${data.userId}`);
        }
      } catch (error) {
        console.error(`[${timestamp}] Error fetching partnerId for user ${data.userId}:`, error);
        // Generate fallback partnerId
        partnerId = data.userId + 1000000;
        console.log(`[${timestamp}] Fallback generated partnerId ${partnerId} for user ${data.userId}`);
      }
      await setUserSocketMap(data.userId, partnerId, socket.id);
      socket.data.userId = data.userId;
      console.log(`[${timestamp}] [SOCKET MAP] Bound user ${data.userId} to socket ${socket.id} with partnerId ${partnerId}`);
      console.log(`[${timestamp}] [SOCKET MAP] Current userSocketMap entry: userId=${data.userId}, partnerId=${partnerId}, socketId=${socket.id}`);
    });

    // Provide socketId to client on request
    socket.on("get-socket-id", async (data: { userId: number }) => {
      const timestamp = new Date().toISOString();
      if (!data?.userId) {
        console.warn(`[${timestamp}] [SOCKET MAP] get-socket-id called without userId`);
        socket.emit("socket-id-response", { socketId: null });
        return;
      }
      const socketId = await getUserSocketId(data.userId);
      console.log(`[${timestamp}] [SOCKET MAP] Provided socketId ${socketId} for user ${data.userId}`);
      socket.emit("socket-id-response", { socketId });
    });

    // Handle call end event to clear mapping
    socket.on("call-ended", async (data: { userId: number }) => {
      const timestamp = new Date().toISOString();
      if (!data?.userId) {
        console.warn(`[${timestamp}] [SOCKET MAP] call-ended called without userId`);
        return;
      }
      const existingSocketId = await getUserSocketId(data.userId);
      if (existingSocketId === socket.id) {
        await deleteUserSocketMap(data.userId);
        console.log(`[${timestamp}] [CALL END] Removed user ${data.userId} from socket map on call end`);
      }
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
    });

    socket.on("webrtc-answer", async (data: any) => {
      const timestamp = new Date().toISOString();
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
    });

    socket.on("webrtc-ice-candidate", async (data: any) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [SIGNAL] Received webrtc-ice-candidate from ${socket.id} to forward to userId ${data.targetUserId}`, data);
      const targetSocket = await getUserSocketId(data.targetUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc-ice-candidate", {
          fromSocketId: socket.id,
          candidate: data.candidate,
        });
        console.log(`[${timestamp}] [SIGNAL] Forwarded webrtc-ice-candidate from ${socket.id} to socketId ${targetSocket}`);

        // Forward test message for debugging ICE candidate sending
        io.to(targetSocket).emit("test-message", {
          message: "ICE candidate forwarded by server",
          fromSocketId: socket.id,
          candidate: data.candidate,
          timestamp,
        });
      } else {
        console.warn(`[${timestamp}] [SIGNAL] Target userId ${data.targetUserId} not found for webrtc-ice-candidate`);
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