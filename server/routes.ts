import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import { setupWebSocket } from "./websocket";

import { db, pool } from "./db";
import { sql } from "drizzle-orm";

export async function registerRoutes(app: Express): Promise<Server> {
  // Get mood statistics
  app.get("/api/moods/stats", async (req, res) => {
    try {
      const stats = await storage.getMoodStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting mood stats:", error);
      res.status(500).json({ error: "Failed to get mood statistics" });
    }
  });

  // Create anonymous session for mood matching
  app.post("/api/session/create", async (req, res) => {
    try {
      const { mood } = req.body;
      
      if (!mood) {
        return res.status(400).json({ error: "Mood is required" });
      }

      // Create anonymous user for this session
      const anonymousUser = await storage.createAnonymousUser();
      const session = await storage.createChatSession({
        userId: anonymousUser.id,
        mood,
      });

      res.json({ 
        sessionId: session.id, 
        userId: anonymousUser.id,
        mood: session.mood 
      });
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  // End chat session
  app.post("/api/session/:sessionId/end", async (req, res) => {
    try {
      const { sessionId } = req.params;
      await storage.endChatSession(parseInt(sessionId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error ending session:", error);
      res.status(500).json({ error: "Failed to end session" });
    }
  });

  // New route to check if database has tables
  app.get("/api/db/tables", async (req, res) => {
    try {
      const tables = await db.select().from(sql`pg_tables`).where(sql`schemaname = 'public'`);
      const tableNames = tables.map((row: any) => row.tablename);
      res.json({ tables: tableNames, hasTables: tableNames.length > 0 });
    } catch (error) {
      console.error("Error fetching tables:", error);
      res.status(500).json({ error: "Failed to fetch tables" });
    }
  });

  const httpServer = createServer(app);
  
  // Setup Socket.IO
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  setupWebSocket(io);

  return httpServer;
}
