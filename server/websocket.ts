import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { db } from "./db";
import { moodQueue } from "@shared/schema";
import { or, eq, lt } from "drizzle-orm";
import type { Mood } from "@shared/schema";

const MATCH_INTERVAL = 5000;
const MAX_QUEUE_TIME = 300000;

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

export function setupWebSocket(server: any) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    let userId: number | null = null;
    let mood: Mood | null = null;
    let socketId: string | null = getSocketId(ws);

    ws.on("message", async (msg) => {
      try {
        const message = JSON.parse(msg.toString());
        if (message.type === "join-queue") {
          userId = message.userId;
          mood = message.mood;
          if (!userId || !mood) return;
          userSocketMap.set(userId, ws);
          userSocketIdMap.set(userId, socketId!);
          await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
          await db.insert(moodQueue).values({
            userId,
            mood,
            socketId: socketId!,
            createdAt: new Date(),
          });
          ws.send(JSON.stringify({ type: "queue-status", status: "waiting", mood }));
          console.log(`[WS] User ${userId} joined queue for mood "${mood}"`);
        } else if (message.type === "leave-queue") {
          if (!userId) return;
          await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
          userSocketMap.delete(userId);
          userSocketIdMap.delete(userId);
          ws.send(JSON.stringify({ type: "queue-status", status: "left" }));
          console.log(`[WS] User ${userId} left the queue`);
        } else if (message.type === "signal") {
          const { to, data } = message;
          const partnerWs = userSocketMap.get(to);
          if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
            partnerWs.send(JSON.stringify({
              type: "signal",
              from: userId,
              data,
            }));
          }
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
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
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

      const moodGroups = new Map<Mood, QueueEntry[]>();
      for (const entry of queue) {
        if (!moodGroups.has(entry.mood)) moodGroups.set(entry.mood, []);
        moodGroups.get(entry.mood)!.push(entry);
      }
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
            userSocketMap.delete(userA.userId);
            userSocketMap.delete(userB.userId);
            userSocketIdMap.delete(userA.userId);
            userSocketIdMap.delete(userB.userId);
            continue;
          }
          // Create sessions in DB
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
          // Notify both users
          wsA.send(JSON.stringify({
            type: "match-found",
            role: "initiator",
            partnerId: userB.userId,
            sessionId: sessionA.id,
          }));
          wsB.send(JSON.stringify({
            type: "match-found",
            role: "receiver",
            partnerId: userA.userId,
            sessionId: sessionB.id,
          }));
          console.log(`[WS] Matched users ${userA.userId} and ${userB.userId} for mood "${mood}"`);
          // Remove from queue in DB and memory
          await db.delete(moodQueue).where(
            or(eq(moodQueue.userId, userA.userId), eq(moodQueue.userId, userB.userId))
          );
          userSocketMap.delete(userA.userId);
          userSocketMap.delete(userB.userId);
          userSocketIdMap.delete(userA.userId);
          userSocketIdMap.delete(userB.userId);
        }
      }
      // Cleanup stale entries
      const cutoffTime = new Date(Date.now() - MAX_QUEUE_TIME);
      await db.delete(moodQueue).where(lt(moodQueue.createdAt, cutoffTime));
    } catch (err) {
      console.error("[WS] Matchmaking error:", err);
    }
  }, MATCH_INTERVAL);

  console.log("[WS] Native WebSocket server for signaling and matchmaking started.");
}