import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";

/**
 * Register all HTTP API routes here.
 * This should be called before creating the HTTP server.
 */
export async function registerRoutes(app: Express): Promise<void> {
  // Health check
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Get mood statistics
  app.get("/api/moods/stats", async (_req, res) => {
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

      const anonymousUser = await storage.createAnonymousUser();
      const session = await storage.createChatSession({
        userId: anonymousUser.id,
        mood,
      });

      res.json({
        sessionId: session.id,
        userId: anonymousUser.id,
        mood: session.mood,
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

  // Check available tables
  app.get("/api/db/tables", async (_req, res) => {
    try {
      const tables = await db
        .select()
        .from(sql`pg_tables`)
        .where(sql`schemaname = 'public'`);
      const tableNames = tables.map((row: any) => row.tablename);
      res.json({ tables: tableNames, hasTables: tableNames.length > 0 });
    } catch (error) {
      console.error("Error fetching tables:", error);
      res.status(500).json({ error: "Failed to fetch tables" });
    }
  });
}
