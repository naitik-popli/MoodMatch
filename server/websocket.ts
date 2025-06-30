// websocket.ts
import { Server as SocketIOServer, Socket } from "socket.io";
import { storage } from "./storage";
import { db } from "./db";
import { moodQueue, chatSessions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logToFile } from './backend-logs.js';
import type { Mood } from "@shared/schema";

interface SocketData {
  userId?: number;
  mood?: Mood;
  sessionId?: number;
  partnerId?: number;
}

// Configuration
const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const MATCH_INTERVAL = 5000; // 5 seconds
const MAX_QUEUE_TIME = 300000; // 5 minutes

// Data structures
const userSocketMap = new Map<number, string>();
const activeSessions = new Set<number>();

export function setupWebSocket(io: SocketIOServer) {
  console.log("[WS] Initializing WebSocket server");
  logToFile("WebSocket server starting");

  // Matching algorithm
  const matchUsers = async () => {
    try {
      if (DEBUG_MODE) console.log("[MATCH] Starting matching cycle");
      
      // Get all users in queue grouped by mood
      const queue = await db.select()
        .from(moodQueue)
        .orderBy(moodQueue.createdAt);

      const moodGroups = new Map<Mood, typeof queue>();
      
      for (const user of queue) {
        if (!moodGroups.has(user.mood)) {
          moodGroups.set(user.mood, []);
        }
        moodGroups.get(user.mood)!.push(user);
      }

      // Process each mood group
      for (const [mood, users] of moodGroups) {
        if (users.length < 2) continue;

        // Match users in pairs
        while (users.length >= 2) {
          const userA = users.shift()!;
          const userB = users.shift()!;

          // Create chat session
          const sessionId = await storage.createChatSession({
            userAId: userA.userId,
            userBId: userB.userId,
            mood
          });

          // Notify both users
          await notifyMatchedPair(io, userA.userId, userB.userId, sessionId);
          
          // Remove from queue
          await Promise.all([
            storage.removeFromMoodQueue(userA.userId),
            storage.removeFromMoodQueue(userB.userId)
          ]);

          if (DEBUG_MODE) {
            console.log(`[MATCH] Paired users ${userA.userId} and ${userB.userId} for mood ${mood}`);
          }
        }
      }

      // Cleanup stale queue entries
      await db.delete(moodQueue)
        .where(
          and(
            eq(moodQueue.createdAt, new Date(Date.now() - MAX_QUEUE_TIME))
        )      );

    } catch (error) {
      console.error("[MATCH] Error in matching cycle:", error);
      logToFile(`Matching error: ${error instanceof Error ? error.stack : error}`);
    }
  };

  // Start matching interval
  const matchingInterval = setInterval(matchUsers, MATCH_INTERVAL);

  io.on("connection", async (socket: Socket<{}, {}, {}, SocketData>) => {
    const connId = socket.id.slice(0, 6);
    console.log(`[CONN ${connId}] New connection`);

    // Update socket mapping
    socket.on("update-socket-id", (data: { userId: number }) => {
      if (!data?.userId) return;
      
      userSocketMap.set(data.userId, socket.id);
      socket.data.userId = data.userId;
    });

    // Join queue with enhanced validation
    socket.on("join-mood-queue", async (data: { userId: number; mood: Mood }) => {
      try {
        if (!data?.userId || !data?.mood) {
          throw new Error("Missing required fields");
        }

        console.log(`[QUEUE ${data.userId}] Joining queue for ${data.mood}`);
        
        // Remove from any existing queue first
        await storage.removeFromMoodQueue(data.userId);
        
        // Add to queue
        await storage.addToMoodQueue({
          userId: data.userId,
          mood: data.mood,
          socketId: socket.id
        });

        socket.emit("queue-status", { 
          status: "waiting", 
          mood: data.mood,
          position: await getQueuePosition(data.userId)
        });

        // Trigger immediate matching attempt
        await matchUsers();

      } catch (error) {
        console.error(`[QUEUE] Error for user ${data.userId}:`, error);
        socket.emit("queue-error", { 
          message: error instanceof Error ? error.message : "Queue join failed"
        });
      }
    });

    // Disconnect handler
    socket.on("disconnect", async () => {
      if (!socket.data?.userId) return;
      
      const userId = socket.data.userId;
      console.log(`[DISCONNECT ${userId}] Handling disconnect`);

      // Only remove from queue if not in active session
      if (!activeSessions.has(userId)) {
        await storage.removeFromMoodQueue(userId);
      }
    });
  });

  // Cleanup on shutdown
  process.on('SIGTERM', () => {
    clearInterval(matchingInterval);
    console.log("[WS] Cleaned up matching interval");
  });
}

// Helper to get queue position
async function getQueuePosition(userId: number): Promise<number> {
  const queue = await db.select()
    .from(moodQueue)
    .orderBy(moodQueue.createdAt);
  
  return queue.findIndex(u => u.userId === userId) + 1;
}

// Enhanced matching notification
async function notifyMatchedPair(io: SocketIOServer, userA: number, userB: number, sessionId: number) {
  const socketA = userSocketMap.get(userA);
  const socketB = userSocketMap.get(userB);

  if (!socketA || !socketB) {
    console.warn(`[MATCH] Missing sockets for pair ${userA}/${userB}`);
    return;
  }

  try {
    // Update active sessions
    activeSessions.add(userA);
    activeSessions.add(userB);

    // Notify both users
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

    console.log(`[MATCH] Successfully notified pair ${userA}/${userB} for session ${sessionId}`);

  } catch (error) {
    console.error(`[MATCH] Error notifying pair ${userA}/${userB}:`, error);
    // Cleanup failed match
    await Promise.all([
      storage.removeFromMoodQueue(userA),
      storage.removeFromMoodQueue(userB)
    ]);
  }
}