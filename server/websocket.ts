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

// Debugging constants
const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const MATCH_INTERVAL = 5000; // 5 seconds

const userSocketMap: Map<number, string> = new Map();
const activeMatchOperations = new Set<number>();
let matchingInterval: NodeJS.Timeout;

export function setupWebSocket(io: SocketIOServer) {
  console.log("[WS] Initializing WebSocket server");
  logToFile("WebSocket server starting");

  // Start periodic matching
  matchingInterval = setInterval(async () => {
    try {
      if (DEBUG_MODE) console.log("[MATCH] Starting periodic matching cycle");
      
      const matches = await storage.matchAllMoodQueueUsers();
      
      if (DEBUG_MODE) {
        console.log(`[MATCH] Found ${matches.length} matches this cycle`);
        console.log("[MATCH] Results:", matches);
      }

      for (const match of matches) {
        notifyMatchedPair(io, match.userA, match.userB, match.sessionId);
      }
    } catch (error) {
      console.error("[MATCH] Periodic matching error:", error);
      logToFile(`Periodic matching error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, MATCH_INTERVAL);

  io.on("connection", async (socket: Socket<{}, {}, {}, SocketData>) => {
    const connId = socket.id.slice(0, 6);
    console.log(`[CONN ${connId}] New connection`);
    logToFile(`New connection: ${socket.id}`);

    // Socket ID update handler
    socket.on("update-socket-id", (data: { userId: number }) => {
      if (!data?.userId) {
        if (DEBUG_MODE) console.log(`[CONN ${connId}] Missing userId in update-socket-id`);
        return;
      }

      console.log(`[CONN ${connId}] Updating socket ID for user ${data.userId}`);
      userSocketMap.set(data.userId, socket.id);
      socket.data.userId = data.userId;
    });

    // Mood queue join handler
    // In websocket.ts connection handler:
socket.on("join-mood-queue", async (data) => {
  try {
    const { userId, mood, sessionId } = data;
    console.log(`[QUEUE ${userId}] Join request for ${mood}`);

    // Add to queue (upsert style)
    await storage.addToMoodQueue({ 
      userId, 
      mood, 
      socketId: socket.id 
    });

    // Debug current queue state
    const queue = await db.select().from(moodQueue);
    console.log(`[QUEUE] Current state:`, queue);

    // Immediate match attempt
    const matches = await storage.matchAllMoodQueueUsers();
    if (matches.length > 0) {
      console.log(`[QUEUE ${userId}] Found immediate matches`);
    }

    socket.emit("waiting-for-match", { mood });
    
  } catch (error) {
    console.error(`[QUEUE ${userId}] Join error:`, error);
    socket.emit("error", { message: "Queue join failed" });
  }
});

// Modified disconnect handler:
socket.on("disconnect", async () => {
  const { userId } = socket.data || {};
  if (!userId) return;

  console.log(`[DISCONNECT ${userId}] Handling disconnect`);
  
  // Only remove from queue if not matched
  const [session] = await db.select()
    .from(chatSessions)
    .where(and(
      eq(chatSessions.userId, userId),
      eq(chatSessions.isActive, true)
    ))
    .limit(1);

  if (!session?.partnerId) {
    console.log(`[DISCONNECT ${userId}] Removing from queue`);
    await storage.removeFromMoodQueue(userId);
  } else {
    console.log(`[DISCONNECT ${userId}] Keeping in active session`);
  }
});
    // Queue leave handler
    socket.on("leave-mood-queue", async () => {
      if (!socket.data?.userId) {
        if (DEBUG_MODE) console.log(`[CONN ${connId}] Leave request with no userId`);
        return;
      }

      const userId = socket.data.userId;
      console.log(`[QUEUE ${userId}] Leaving queue`);

      try {
        await storage.removeFromMoodQueue(userId);
        socket.emit("left-queue");
        logToFile(`User ${userId} left queue`);
      } catch (error) {
        console.error(`[QUEUE ${userId}] Leave error:`, error);
        logToFile(`Leave error for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // WebRTC handlers
    const createWebRTCHandler = (type: string) => 
      (data: { targetSocketId: string; payload: any }) => {
        if (DEBUG_MODE) console.log(`[WEBRTC ${connId}] ${type} to ${data.targetSocketId.slice(0, 6)}`);
        
        const targetSocket = io.sockets.sockets.get(data.targetSocketId);
        if (!targetSocket) {
          if (DEBUG_MODE) console.log(`[WEBRTC ${connId}] Target not found`);
          return;
        }

        targetSocket.emit(type, {
          fromSocketId: socket.id,
          ...data.payload,
        });
      };

    socket.on("webrtc-offer", createWebRTCHandler("webrtc-offer"));
    socket.on("webrtc-answer", createWebRTCHandler("webrtc-answer"));
    socket.on("webrtc-ice-candidate", createWebRTCHandler("webrtc-ice-candidate"));

    // Call termination handler
    socket.on("end-call", async (data: { sessionId: number }) => {
      if (!data.sessionId) {
        console.log(`[CALL ${connId}] End call with no sessionId`);
        return;
      }

      console.log(`[CALL ${connId}] Ending session ${data.sessionId}`);
      
      try {
        await storage.endChatSession(data.sessionId);

        if (socket.data?.partnerId) {
          const partnerSocketId = userSocketMap.get(socket.data.partnerId);
          if (partnerSocketId) {
            io.to(partnerSocketId).emit("call-ended", {
              reason: "Partner ended call",
              sessionId: data.sessionId,
            });
          }
        }

        socket.emit("call-ended", {
          reason: "Call ended successfully",
          sessionId: data.sessionId,
        });

        logToFile(`Call ended for session ${data.sessionId}`);
      } catch (error) {
        console.error(`[CALL ${connId}] End error:`, error);
        logToFile(`Call end error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Disconnect handler
    socket.on("disconnect", async () => {
      console.log(`[CONN ${connId}] Disconnecting`);
      logToFile(`Client disconnected: ${socket.id}`);

      try {
        if (socket.data?.userId) {
          const { userId, partnerId, sessionId } = socket.data;
          userSocketMap.delete(userId);

          // Clean up queue and sessions
          await Promise.all([
            storage.removeFromMoodQueue(userId),
            sessionId ? storage.endChatSession(sessionId) : Promise.resolve(),
          ]);

          // Notify partner if connected
          if (partnerId) {
            const partnerSocketId = userSocketMap.get(partnerId);
            if (partnerSocketId) {
              io.to(partnerSocketId).emit("call-ended", {
                reason: "Partner disconnected",
                sessionId: sessionId,
              });
            }
          }
        }
      } catch (error) {
        console.error(`[CONN ${connId}] Disconnect error:`, error);
        logToFile(`Disconnect error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });

  // Cleanup on server shutdown
  process.on('SIGTERM', () => {
    console.log("[WS] Cleaning up WebSocket server");
    clearInterval(matchingInterval);
  });
}

// Helper function to notify matched users
// In the notifyMatchedPair function:
// Replace the notifyMatchedPair function with this corrected version:
// In the notifyMatchedPair function:
async function notifyMatchedPair(io: SocketIOServer, userA: number, userB: number, sessionId: number) {
  console.log(`[MATCH] Notifying pair ${userA} and ${userB}`);
  
  const socketA = userSocketMap.get(userA);
  const socketB = userSocketMap.get(userB);

  if (socketA && socketB) {
    // Get socket instances safely
    const socketAInstance = io.sockets.sockets.get(socketA);
    const socketBInstance = io.sockets.sockets.get(socketB);

    // Update socket data if instances exist
    if (socketAInstance) {
      socketAInstance.data = {
        ...socketAInstance.data,
        partnerId: userB,
        sessionId
      };
    }
    if (socketBInstance) {
      socketBInstance.data = {
        ...socketBInstance.data,
        partnerId: userA,
        sessionId
      };
    }

    // Send notifications
    io.to(socketA).emit("match-found", {
      partnerId: userB,
      partnerSocketId: socketB,
      sessionId,
    });

    io.to(socketB).emit("match-found", {
      partnerId: userA,
      partnerSocketId: socketA,
      sessionId,
    });

    // Track connections (non-blocking)
    try {
      await Promise.all([
        storage.addConnectedUser(userA, sessionId, "matched"),
        storage.addConnectedUser(userB, sessionId, "matched")
      ]);
    } catch (error) {
      console.error('[MATCH] Non-critical connection tracking error:', error);
    }
  }
}