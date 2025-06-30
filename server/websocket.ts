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

// Improved debugging setup
const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const MATCH_INTERVAL = parseInt(process.env.MATCH_INTERVAL || "5000");
const MAX_MATCH_ATTEMPTS = 3;

// Enhanced data structures
const userSocketMap = new Map<number, string>();
const activeMatchOperations = new Set<number>();
const connectionAttempts = new Map<string, number>();

export function setupWebSocket(io: SocketIOServer) {
  console.log("[WS] Initializing WebSocket server with debug:", DEBUG_MODE);
  logToFile("WebSocket server starting");

  // Robust matching interval with cleanup
  const matchingInterval = setInterval(async () => {
    try {
      if (DEBUG_MODE) console.log("[MATCH] Starting matching cycle");
      
      if (activeMatchOperations.size > 0) {
        if (DEBUG_MODE) console.log("[MATCH] Skipping - existing operations running");
        return;
      }

      const matches = await storage.matchAllMoodQueueUsers();
      
      if (matches.length > 0 && DEBUG_MODE) {
        console.log(`[MATCH] Found ${matches.length} matches`);
      }

      await Promise.all(matches.map(async match => {
        activeMatchOperations.add(match.userA);
        activeMatchOperations.add(match.userB);
        
        try {
          await notifyMatchedPair(io, match.userA, match.userB, match.sessionId);
        } finally {
          activeMatchOperations.delete(match.userA);
          activeMatchOperations.delete(match.userB);
        }
      }));
    } catch (error) {
      console.error("[MATCH] Error in matching cycle:", error);
      logToFile(`Matching error: ${error instanceof Error ? error.stack : error}`);
    }
  }, MATCH_INTERVAL);

  io.on("connection", async (socket: Socket<{}, {}, {}, SocketData>) => {
    const connId = socket.id.slice(0, 6);
    console.log(`[CONN ${connId}] New connection`);
    logToFile(`New connection: ${socket.id}`);

    // Enhanced socket ID management
    socket.on("update-socket-id", (data: { userId: number }) => {
      if (!data?.userId) {
        console.warn(`[CONN ${connId}] Missing userId in update-socket-id`);
        return;
      }

      const attempts = connectionAttempts.get(socket.id) || 0;
      if (attempts > MAX_MATCH_ATTEMPTS) {
        console.warn(`[CONN ${connId}] Too many attempts for user ${data.userId}`);
        socket.disconnect();
        return;
      }

      connectionAttempts.set(socket.id, attempts + 1);
      userSocketMap.set(data.userId, socket.id);
      socket.data.userId = data.userId;
    });

    // Robust queue joining
    socket.on("join-mood-queue", async (data: { userId: number; mood: Mood; sessionId?: number }) => {
      try {
        if (!data?.userId || !data?.mood) {
          throw new Error("Missing required fields");
        }

        console.log(`[QUEUE ${data.userId}] Join request for ${data.mood}`);
        
        await storage.addToMoodQueue({
          userId: data.userId,
          mood: data.mood,
          socketId: socket.id
        });

        if (DEBUG_MODE) {
          const queue = await db.select().from(moodQueue);
          console.log(`[QUEUE] Current state:`, queue);
        }

        socket.emit("queue-status", { status: "waiting", mood: data.mood });
      } catch (error) {
        console.error(`[QUEUE] Join error:`, error);
        socket.emit("error", { 
          code: "QUEUE_JOIN_FAILED",
          message: error instanceof Error ? error.message : "Queue join failed"
        });
      }
    });

    // Improved disconnect handling
    socket.on("disconnect", async () => {
      console.log(`[CONN ${connId}] Disconnecting`);
      
      try {
        if (socket.data?.userId) {
          const { userId, partnerId, sessionId } = socket.data;
          userSocketMap.delete(userId);

          // Only remove from queue if not in active session
          const [activeSession] = await db.select()
            .from(chatSessions)
            .where(and(
              eq(chatSessions.userId, userId),
              eq(chatSessions.isActive, true)
            ))
            .limit(1);

          if (!activeSession) {
            await storage.removeFromMoodQueue(userId);
          }

          // Notify partner if exists
          if (partnerId && sessionId) {
            const partnerSocketId = userSocketMap.get(partnerId);
            if (partnerSocketId) {
              io.to(partnerSocketId).emit("partner-disconnected", { sessionId });
            }
          }
        }
      } catch (error) {
        console.error(`[CONN ${connId}] Disconnect error:`, error);
      }
    });

    // WebRTC handlers with validation
    const createWebRTCHandler = (type: string) => (data: any) => {
      if (!data?.targetSocketId) {
        console.warn(`[WEBRTC ${connId}] Missing targetSocketId for ${type}`);
        return;
      }

      const targetSocket = io.sockets.sockets.get(data.targetSocketId);
      if (!targetSocket) {
        console.warn(`[WEBRTC ${connId}] Target socket not found`);
        return;
      }

      targetSocket.emit(type, {
        fromSocketId: socket.id,
        ...data,
      });
    };

    socket.on("webrtc-offer", createWebRTCHandler("webrtc-offer"));
    socket.on("webrtc-answer", createWebRTCHandler("webrtc-answer"));
    socket.on("webrtc-ice-candidate", createWebRTCHandler("webrtc-ice-candidate"));

    // Session management
    socket.on("end-call", async (data: { sessionId: number }) => {
      if (!data?.sessionId) {
        console.warn(`[CALL ${connId}] Missing sessionId`);
        return;
      }

      try {
        await storage.endChatSession(data.sessionId);
        
        if (socket.data?.partnerId) {
          const partnerSocketId = userSocketMap.get(socket.data.partnerId);
          if (partnerSocketId) {
            io.to(partnerSocketId).emit("call-ended", {
              sessionId: data.sessionId,
              reason: "partner-ended"
            });
          }
        }

        socket.emit("call-ended", {
          sessionId: data.sessionId,
          reason: "user-ended"
        });
      } catch (error) {
        console.error(`[CALL ${connId}] Error ending session:`, error);
      }
    });
  });

  // Cleanup handler
  const cleanup = () => {
    clearInterval(matchingInterval);
    console.log("[WS] Cleaned up WebSocket server");
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
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
    const [socketAInstance, socketBInstance] = [
      io.sockets.sockets.get(socketA),
      io.sockets.sockets.get(socketB)
    ];

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

    // Non-blocking session tracking
    Promise.all([
      storage.addConnectedUser(userA, sessionId, "matched"),
      storage.addConnectedUser(userB, sessionId, "matched")
    ]).catch(error => {
      console.error('[MATCH] Non-critical tracking error:', error);
    });
  } catch (error) {
    console.error(`[MATCH] Error notifying pair ${userA}/${userB}:`, error);
  }
}