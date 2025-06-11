import { 
  users, 
  chatSessions,
  moodQueue,
  type User, 
  type InsertUser, 
  type ChatSession,
  type InsertChatSession,
  type MoodQueue,
  type InsertMoodQueue,
  type Mood 
} from "@shared/schema";
import { db } from "./db";
import { eq, and, ne } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(insertUser: InsertUser): Promise<User>;
  createAnonymousUser(): Promise<User>;
  createChatSession(insertSession: InsertChatSession): Promise<ChatSession>;
  updateChatSessionPartner(sessionId: number, partnerId: number): Promise<void>;
  endChatSession(sessionId: number): Promise<void>;
  addToMoodQueue(insertQueue: InsertMoodQueue): Promise<MoodQueue>;
  findMoodMatch(userId: number, mood: Mood): Promise<(MoodQueue & { sessionId?: number }) | null>;
  removeFromMoodQueue(userId: number): Promise<void>;
  getMoodStats(): Promise<Record<Mood, number>>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async createAnonymousUser(): Promise<User> {
    const username = `anonymous_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const password = Math.random().toString(36).substring(7);
    
    return this.createUser({ username, password });
  }

  async createChatSession(insertSession: InsertChatSession): Promise<ChatSession> {
    const [session] = await db
      .insert(chatSessions)
      .values(insertSession)
      .returning();
    return session;
  }

  async updateChatSessionPartner(sessionId: number, partnerId: number): Promise<void> {
    await db
      .update(chatSessions)
      .set({ partnerId })
      .where(eq(chatSessions.id, sessionId));
  }

  async endChatSession(sessionId: number): Promise<void> {
    await db
      .update(chatSessions)
      .set({ isActive: false, endedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  }

  async addToMoodQueue(insertQueue: InsertMoodQueue): Promise<MoodQueue> {
    const [queue] = await db
      .insert(moodQueue)
      .values(insertQueue)
      .returning();
    return queue;
  }

  async findMoodMatch(userId: number, mood: Mood): Promise<(MoodQueue & { sessionId?: number }) | null> {
    // Find someone else in the queue with the same mood
    const [match] = await db
      .select()
      .from(moodQueue)
      .where(and(
        eq(moodQueue.mood, mood),
        // Make sure it's not the same user
        // Note: We can't use ne() directly, so we'll filter in application logic
      ))
      .limit(1);

    if (match && match.userId !== userId) {
      // Find their active session
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(and(
          eq(chatSessions.userId, match.userId),
          eq(chatSessions.isActive, true)
        ))
        .limit(1);

      return {
        ...match,
        sessionId: session?.id
      };
    }

    return null;
  }

  async removeFromMoodQueue(userId: number): Promise<void> {
    await db
      .delete(moodQueue)
      .where(eq(moodQueue.userId, userId));
  }

  async getMoodStats(): Promise<Record<Mood, number>> {
    const stats = await db
      .select()
      .from(moodQueue);

    const moodCounts: Record<Mood, number> = {
      happy: 0,
      relaxed: 0,
      energetic: 0,
      thoughtful: 0,
      creative: 0,
      adventurous: 0,
      nostalgic: 0,
      curious: 0,
    };

    stats.forEach(item => {
      if (item.mood in moodCounts) {
        moodCounts[item.mood as Mood]++;
      }
    });

    return moodCounts;
  }
}

export const storage = new DatabaseStorage();