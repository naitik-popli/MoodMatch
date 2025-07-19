import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { db } from "./db";
import { moodQueue } from "@shared/schema";
import { or, eq, lt } from "drizzle-orm";
import type { Mood } from "@shared/schema";

const MATCH_INTERVAL = 5000;
const MAX_QUEUE_TIME = 300000; // 5 minutes
const pendingSignals = new Map<number, any[]>(); // userId -> array of messages
const userSocketMap = new Map<number, WebSocket>();
const userSocketIdMap = new Map<number, string>();

interface QueueEntry {
  userId: number;
  mood: Mood;
  socketId: string;
  createdAt: Date;
}

function getSocketId(ws: WebSocket): string {
  return Math.random().toString(36).slice(2) + Date.now();
}

function logConnectedClients() {
  console.log(`[WS] Connected clients: ${userSocketMap.size}`);
  console.log(`[WS] Connected userIds: [${[...userSocketMap.keys()].join(", ")}]`);
  console.log(`[WS] Connected socketIds: [${[...userSocketIdMap.values()].join(", ")}]`);
}

export function setupWebSocket(server: any) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    let userId: number | null = null;
    let mood: Mood | null = null;
    let socketId: string | null = getSocketId(ws);

    console.log("[WS] New connection established. Assigned socketId:", socketId);
    ws.send(JSON.stringify({ type: "socket-id", socketId }));

    ws.on("message", async (msg: Buffer) => {
      try {
        const message = JSON.parse(msg.toString());
        console.log("[WS] Received message:", message);

        // --- JOIN QUEUE ---
        if (message.type === "join-queue") {
          userId = message.userId;
          mood = message.mood;
          if (!userId || !mood) {
            ws.send(JSON.stringify({ type: "error", message: "Missing userId or mood" }));
            console.warn("[WS] join-queue: Missing userId or mood", { userId, mood });
            return;
          }

          // Defensive: Remove any previous socket for this userId
          if (userSocketMap.has(userId)) {
            const oldSocket = userSocketMap.get(userId);
            if (oldSocket && oldSocket !== ws) {
              try {
                oldSocket.close();
                console.warn(`[WS] Closed previous socket for userId ${userId}`);
              } catch (err) {
                console.error(`[WS] Error closing previous socket for userId ${userId}:`, err);
              }
            }
            userSocketMap.delete(userId);
            userSocketIdMap.delete(userId);
            // Remove from queue in DB
            await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
          }

          userSocketMap.set(userId, ws);
          if (pendingSignals.has(userId)) {
            console.log(`[WS] Delivering ${pendingSignals.get(userId)!.length} buffered signals to user ${userId}`);
            for (const msg of pendingSignals.get(userId)!) {
              ws.send(JSON.stringify(msg));
            }
            pendingSignals.delete(userId);
          }
          userSocketIdMap.set(userId, socketId!);

          await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
          await db.insert(moodQueue).values({
            userId,
            mood,
            socketId: socketId!,
            createdAt: new Date(),
          });
          ws.send(JSON.stringify({ type: "queue-status", status: "waiting", mood }));
          console.log(`[WS] User ${userId} joined queue for mood "${mood}" (socketId: ${socketId})`);
          logConnectedClients();
        }

        // --- LEAVE QUEUE ---
        else if (message.type === "leave-queue") {
          if (!userId) {
            ws.send(JSON.stringify({ type: "error", message: "Missing userId" }));
            console.warn("[WS] leave-queue: Missing userId");
            return;
          }
          await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
          userSocketMap.delete(userId);
          userSocketIdMap.delete(userId);
          ws.send(JSON.stringify({ type: "queue-status", status: "left" }));
          console.log(`[WS] User ${userId} left the queue`);
          logConnectedClients();
        }

        // --- SIGNALING ---
        else if (message.type === "signal") {
          const { to, data } = message;
          if (!to || !data) {
            ws.send(JSON.stringify({ type: "error", message: "Missing 'to' or 'data' in signal" }));
            console.warn("[WS] signal: Missing 'to' or 'data'", { to, data });
            return;
          }
          const partnerWs = userSocketMap.get(to);
          if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
            partnerWs.send(JSON.stringify({
              type: "signal",
              from: userId,
              data,
            }));
            console.log(`[WS] Forwarded signal from ${userId} to ${to}`);
          } else {
            // Buffer the message
            if (!pendingSignals.has(to)) pendingSignals.set(to, []);
            pendingSignals.get(to)!.push({
              type: "signal",
              from: userId,
              data,
            });
            console.warn(`[WS] Partner ${to} not connected, buffering signal`);
          }
        }

        // --- UNKNOWN MESSAGE TYPE ---
        else {
          ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
          console.warn("[WS] Unknown message type received:", message.type);
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
        console.error("[WS] Invalid message format:", err);
      }
    });

    ws.on("close", async () => {
      if (userId) {
        userSocketMap.delete(userId);
        userSocketIdMap.delete(userId);
        await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
        console.log(`[WS] User ${userId} disconnected and removed from queue`);
      } else {
        console.log("[WS] Socket closed with no associated userId");
      }
      logConnectedClients();
    });

    ws.on("error", (err) => {
      console.error("[WS] WebSocket error:", err);
    });
  });

  // --- Matchmaking Loop ---
  setInterval(async () => {
    try {
      const queueRows = await db.select().from(moodQueue).orderBy(moodQueue.createdAt);
      const queue: QueueEntry[] = queueRows.map((row: any) => ({
        userId: row.userId ?? row.user_id,
        mood: row.mood,
        socketId: row.socketId ?? row.socket_id,
        createdAt: row.createdAt ?? row.created_at,
      }));

      console.log(`[WS] Matchmaking: Current queue length: ${queue.length}`);
      logConnectedClients();

      // Group users by mood
      const moodGroups = new Map<Mood, QueueEntry[]>();
      for (const entry of queue) {
        if (!moodGroups.has(entry.mood)) moodGroups.set(entry.mood, []);
        moodGroups.get(entry.mood)!.push(entry);
      }

      // Try to match users in each mood group
      for (const [mood, users] of moodGroups) {
        while (users.length >= 2) {
          const userA = users.shift()!;
          const userB = users.shift()!;
          // Double-check both users are still connected
          const wsA = userSocketMap.get(userA.userId);
          const wsB = userSocketMap.get(userB.userId);
          if (
            !wsA || wsA.readyState !== WebSocket.OPEN ||
            !wsB || wsB.readyState !== WebSocket.OPEN
          ) {
            // Clean up if not connected
            if (wsA) wsA.close();
            if (wsB) wsB.close();
            await db.delete(moodQueue).where(
              or(eq(moodQueue.userId, userA.userId), eq(moodQueue.userId, userB.userId))
            );
            // userSocketMap.delete(userA.userId);
            // userSocketMap.delete(userB.userId);
            // userSocketIdMap.delete(userA.userId);
            // userSocketIdMap.delete(userB.userId);
            console.warn(`[WS] Cleaned up disconnected users: ${userA.userId}, ${userB.userId}`);
            logConnectedClients();
            continue;
          }
          // Create a single sessionId for both users
          const session = await storage.createChatSession({
            userId: userA.userId,
            mood,
            partnerId: userB.userId,
          });
          await storage.createChatSession({
            userId: userB.userId,
            mood,
            partnerId: userA.userId,
          });
          // Notify both users
          wsA.send(JSON.stringify({
            type: "match-found",
            role: "initiator",
            partnerId: userB.userId,
            sessionId: session.id,
          }));
          wsB.send(JSON.stringify({
            type: "match-found",
            role: "receiver",
            partnerId: userA.userId,
            sessionId: session.id,
          }));
          console.log(`[WS] Matched users ${userA.userId} and ${userB.userId} for mood "${mood}" (sessionId: ${session.id})`);
          // Remove from queue in DB and memory
          await db.delete(moodQueue).where(
            or(eq(moodQueue.userId, userA.userId), eq(moodQueue.userId, userB.userId))
          );
          userSocketMap.delete(userA.userId);
          userSocketMap.delete(userB.userId);
          userSocketIdMap.delete(userA.userId);
          userSocketIdMap.delete(userB.userId);
          logConnectedClients();
        }
      }
      // Cleanup stale entries
      const cutoffTime = new Date(Date.now() - MAX_QUEUE_TIME);
      const staleRows = await db.select().from(moodQueue).where(lt(moodQueue.createdAt, cutoffTime));
      if (staleRows.length > 0) {
        console.warn(`[WS] Cleaning up ${staleRows.length} stale queue entries`);
      }
      await db.delete(moodQueue).where(lt(moodQueue.createdAt, cutoffTime));
    } catch (err) {
      console.error("[WS] Matchmaking error:", err);
    }
  }, MATCH_INTERVAL);

  console.log("[WS] Native WebSocket server for signaling and matchmaking started.");
}