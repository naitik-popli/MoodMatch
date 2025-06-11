import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
});

export const moodQueue = pgTable("mood_queue", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  mood: text("mood").notNull(),
  socketId: text("socket_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type MoodQueue = typeof moodQueue.$inferSelect;
export type InsertMoodQueue = z.infer<typeof insertMoodQueueSchema>;

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
