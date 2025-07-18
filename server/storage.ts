import { 
  users, 
  chatSessions,
  moodQueue,
  connectedUsers,
  type User, 
  type InsertUser, 
  type ChatSession,
  type InsertChatSession,
  type MoodQueue,
  type InsertMoodQueue,
  type Mood
} from "@shared/schema";
import { db } from "./db";
import { eq, and, asc } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ---- Place these at the top-level ----
const MOODS = [
  "happy", "relaxed", "energetic", "thoughtful",
  "creative", "adventurous", "nostalgic", "curious"
] as const;

function isMood(val: any): val is Mood {
  return (MOODS as readonly string[]).includes(val);
}
// --------------------------------------

export type MatchResult = {
  userA: number;
  userB: number;
  sessionId: number;
};

export class DatabaseStorage {
  private debugLog(message: string, data?: any) {
    console.log(`[DEBUG][${new Date().toISOString()}] ${message}`, data || '');
  }

  // User Management
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createAnonymousUser(): Promise<User> {
    const username = `anonymous_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return this.createUser({ 
      username, 
      password: Math.random().toString(36).substring(7) 
    });
  }

  // Session Management
  async createChatSession(insertSession: InsertChatSession): Promise<ChatSession> {
    // Check if the user already has an active session
    const [existingSession] = await db.select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.userId, insertSession.userId),
        eq(chatSessions.isActive, true)
      ))
      .limit(1);

    if (existingSession) {
      // Update partnerId if different or null
      if ((existingSession.partnerId ?? null) !== (insertSession.partnerId ?? null)) {
        await db.update(chatSessions)
          .set({ partnerId: insertSession.partnerId ?? null })
          .where(eq(chatSessions.id, existingSession.id));
        this.debugLog(`Updated partnerId for user ${insertSession.userId} in existing session`, { oldPartnerId: existingSession.partnerId, newPartnerId: insertSession.partnerId });
      }
      return { ...existingSession, partnerId: insertSession.partnerId ?? null };
    }

    // Otherwise create a new session
    const [session] = await db.insert(chatSessions)
      .values({
        ...insertSession,
        isActive: true,
        createdAt: new Date()
      })
      .returning();

    return session;
  }

  async getActiveSession(userId: number): Promise<ChatSession | undefined> {
    const [session] = await db.select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.isActive, true)
      ))
      .limit(1);
    return session;
  }

  async updateChatSessionPartner(sessionId: number, partnerId: number): Promise<void> {
    await db.update(chatSessions)
      .set({ partnerId })
      .where(eq(chatSessions.id, sessionId));
  }

  async endChatSession(sessionId: number): Promise<void> {
    await db.update(chatSessions)
      .set({ isActive: false, endedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  }

  // Mood Queue Management
  async addToMoodQueue(insertQueue: InsertMoodQueue): Promise<MoodQueue> {
    try {
      // First try to update existing record
      const [updated] = await db.update(moodQueue)
        .set({
          socketId: insertQueue.socketId,
          mood: insertQueue.mood,
          createdAt: new Date()
        })
        .where(eq(moodQueue.userId, insertQueue.userId))
        .returning();

      if (updated) {
        this.debugLog(`Updated queue entry for user ${insertQueue.userId}`);
        return updated;
      }

      // If no record to update, insert new
      const [queue] = await db.insert(moodQueue)
        .values(insertQueue)
        .returning();

      this.debugLog(`Created new queue entry for user ${insertQueue.userId}`);
      return queue;
    } catch (error) {
      this.debugLog('Error in addToMoodQueue:', error);
      throw error;
    }
  }

  async removeFromMoodQueue(userId: number): Promise<void> {
    this.debugLog(`Removing user ${userId} from queue`);
    await db.delete(moodQueue)
      .where(eq(moodQueue.userId, userId));
  }

  async cleanupStaleQueueEntries(): Promise<number> {
    const deleted = await db.delete(moodQueue)
      .where(sql`created_at < NOW() - INTERVAL '1 hour'`)
      .returning();
    return deleted.length;
  }

  // Matching Algorithm
  async matchAllMoodQueueUsers(): Promise<MatchResult[]> {
    try {
      this.debugLog('Starting matching process');
      
      // Get all users who have been in queue for at least 1 second
      const allUsers = await db.select()
        .from(moodQueue)
        .where(sql`created_at < NOW() - INTERVAL '1 second'`)
        .orderBy(asc(moodQueue.createdAt));

      this.debugLog(`Found ${allUsers.length} users in queue`, allUsers);

      const matches: MatchResult[] = [];
      const moodGroups = new Map<Mood, MoodQueue[]>();

      // Group by mood
      allUsers.forEach(user => {
        const mood = user.mood ?? (user as any).mood_id;
        if (!isMood(mood)) return; // skip invalid moods
        if (!moodGroups.has(mood)) {
          moodGroups.set(mood, []);
        }
        moodGroups.get(mood)!.push(user);
      });

      // Process each mood group separately
      for (const [mood, users] of moodGroups) {
        // Only match within the same mood group
        while (users.length >= 2) {
          const userA = users.shift()!;
          const userB = users.shift()!;

          this.debugLog(`Creating match for ${userA.userId ?? (userA as any).user_id} and ${userB.userId ?? (userB as any).user_id} (mood: ${mood})`);
          
          // Create session pair
          const sessionA = await this.createChatSession({
            userId: userA.userId ?? (userA as any).user_id,
            mood,
            partnerId: userB.userId ?? (userB as any).user_id
          });

          await this.createChatSession({
            userId: userB.userId ?? (userB as any).user_id,
            mood,
            partnerId: userA.userId ?? (userA as any).user_id
          });

          // Remove from queue
          await this.removeFromMoodQueue(userA.userId ?? (userA as any).user_id);
          await this.removeFromMoodQueue(userB.userId ?? (userB as any).user_id);

          matches.push({
            userA: userA.userId ?? (userA as any).user_id,
            userB: userB.userId ?? (userB as any).user_id,
            sessionId: sessionA.id
          });
        }
      }

      return matches;
    } catch (error) {
      this.debugLog('Matching error:', error);
      throw error;
    }
  }

  // Stats & Monitoring
  async getMoodStats(): Promise<Record<Mood, number>> {
    const stats = await db.select().from(moodQueue);
    const moodCounts = stats.reduce((acc, item) => {
      const mood = item.mood ?? (item as any).mood_id;
      if (isMood(mood)) {
        acc[mood] = (acc[mood] || 0) + 1;
      }
      return acc;
    }, {} as Record<Mood, number>);
    return moodCounts;
  }

  // Connection Tracking
  async addConnectedUser(userId: number, sessionId: number, mood: Mood): Promise<void> {
    try {
      // First try to update existing record
      const updated = await db.update(connectedUsers)
        .set({ 
          sessionId,
          mood,
          disconnectedAt: null
        })
        .where(eq(connectedUsers.userId, userId))
        .returning();

      // If no record was updated, insert new
      if (updated.length === 0) {
        await db.insert(connectedUsers)
          .values({ userId, sessionId, mood });
      }
    } catch (error) {
      console.error('Connection tracking error:', error);
      // Non-critical error - don't break the match flow
    }
  }

  async markUserDisconnected(userId: number): Promise<void> {
    await db.update(connectedUsers)
      .set({ disconnectedAt: new Date() })
      .where(eq(connectedUsers.userId, userId));
  }

  async removeDisconnectedUsersFromMoodQueue(): Promise<void> {
    const disconnectedUsers = await db.select()
      .from(connectedUsers)
      .where(sql`disconnected_at IS NOT NULL`);

    await Promise.all(
      disconnectedUsers.map(user => 
        this.removeFromMoodQueue(user.userId ?? (user as any).user_id)
      )
    );
  }
}

export const storage = new DatabaseStorage();