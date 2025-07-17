import { pgTable, text, serial, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";  
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const chatSessions = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  mood: text("mood").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  partnerId: integer("partner_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (table) => ({
  userActiveIdx: uniqueIndex("user_active_idx").on(table.userId).where(sql`is_active = true`),
}));

export const moodQueue = pgTable("mood_queue", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  mood: text("mood").notNull(),
  socketId: text("socket_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: uniqueIndex("user_id_idx").on(table.userId),
}));

export const connectedUsers = pgTable("connected_users", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  sessionId: integer("session_id").notNull(),
  mood: text("mood").notNull(),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  disconnectedAt: timestamp("disconnected_at"),
}, (table) => ({
  userIdIdx: uniqueIndex("connected_user_idx").on(table.userId),
}));

// Zod schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertChatSessionSchema = createInsertSchema(chatSessions).pick({
  userId: true,
  mood: true,
  partnerId: true,
});

export const insertMoodQueueSchema = createInsertSchema(moodQueue).pick({
  userId: true,
  mood: true,
  socketId: true,
  // Optionally add createdAt if you want to validate it on insert
  // createdAt: true,
});

// Type exports
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type MoodQueue = typeof moodQueue.$inferSelect;
export type InsertMoodQueue = z.infer<typeof insertMoodQueueSchema>;

// Helper type for queue entry (camelCase, for server use)
export type QueueEntry = {
  userId: number;
  mood: Mood;
  socketId: string;
  createdAt: Date;
};

export const MOODS = [
  "happy",
  "relaxed", 
  "energetic",
  "thoughtful",
  "creative",
  "adventurous",
  "nostalgic",
  "curious"
] as const;

export type Mood = typeof MOODS[number];