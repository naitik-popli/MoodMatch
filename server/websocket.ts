import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { db } from "./db";
import { moodQueue } from "@shared/schema";
import { and, lt, or, eq } from "drizzle-orm";
import type { Mood } from "@shared/schema";

const MATCH_INTERVAL = 5000;
const MAX_QUEUE_TIME = 300000;

// Map userId to WebSocket connection
const userSocketMap = new Map<number, WebSocket>();

interface QueueEntry {
  userId: number;
  mood: Mood;
  createdAt: Date;
}

// --- WebSocket Setup ---
export function setupWebSocketServer(server: any) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    let userId: number | null = null;
    let mood: Mood | null = null;

    ws.on("message", async (msg) => {
      try {
        const message = JSON.parse(msg.toString());
        if (message.type === "join-queue") {
          userId = message.userId;
          mood = message.mood;
          if (!userId || !mood) return;
          userSocketMap.set(userId, ws);
          await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
          // Make sure the field names match your schema!
          await db.insert(moodQueue).values({
            userId,
            mood,
            createdAt: new Date(),
          });
          ws.send(JSON.stringify({ type: "queue-status", status: "waiting", mood }));
        } else if (message.type === "leave-queue") {
          if (!userId) return;
          await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
          userSocketMap.delete(userId);
          ws.send(JSON.stringify({ type: "queue-status", status: "left" }));
        } else if (message.type === "signal") {
          // Forward signaling data to partner
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
      }
    });

    ws.on("close", async () => {
      if (userId) {
        userSocketMap.delete(userId);
        await db.delete(moodQueue).where(eq(moodQueue.userId, userId));
      }
    });
  });

  // --- Matchmaking Loop ---
  setInterval(async () => {
    // Fetch queue and map fields if needed
    const queueRows = await db.select().from(moodQueue).orderBy(moodQueue.createdAt);
    // If your DB returns snake_case, map to camelCase:
    const queue: QueueEntry[] = queueRows.map((row: any) => ({
      userId: row.userId ?? row.user_id,
      mood: row.mood,
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
        const wsA = userSocketMap.get(userA.userId);
        const wsB = userSocketMap.get(userB.userId);
        if (wsA && wsA.readyState === WebSocket.OPEN) {
          wsA.send(JSON.stringify({
            type: "match-found",
            role: "initiator",
            partnerId: userB.userId,
            sessionId: sessionA.id,
          }));
        }
        if (wsB && wsB.readyState === WebSocket.OPEN) {
          wsB.send(JSON.stringify({
            type: "match-found",
            role: "receiver",
            partnerId: userA.userId,
            sessionId: sessionB.id,
          }));
        }
        // Remove from queue in DB
        await db.delete(moodQueue).where(
          or(eq(moodQueue.userId, userA.userId), eq(moodQueue.userId, userB.userId))
        );
      }
    }
    // Cleanup stale entries
    const cutoffTime = new Date(Date.now() - MAX_QUEUE_TIME);
    await db.delete(moodQueue).where(lt(moodQueue.createdAt, cutoffTime));
  }, MATCH_INTERVAL);

  console.log("[WS] Native WebSocket server for signaling and matchmaking started.");
}