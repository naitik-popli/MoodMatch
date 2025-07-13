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

export type MatchResult = {
  userA: number;
  userB: number;
  sessionId: number;
};

export class DatabaseStorage {
  private debugLog(message: string, data?: any) {
    console.log(`[DEBUG][${new Date().toISOString()}] ${message}`, data ?? '');
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
      if (existingSession.partnerId !== insertSession.partnerId) {
  await db.update(chatSessions)
    .set({ partnerId: insertSession.partnerId ?? null })
    .where(eq(chatSessions.id, existingSession.id));
  this.debugLog(
    `Updated partnerId for user ${insertSession.userId} in existing session`, 
    { oldPartnerId: existingSession.partnerId, newPartnerId: insertSession.partnerId }
  );
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

    this.debugLog(`Created new chat session for user ${insertSession.userId}`, session);
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
    this.debugLog(`Updated partnerId for session ${sessionId} to ${partnerId}`);
  }

  async endChatSession(sessionId: number): Promise<void> {
    await db.update(chatSessions)
      .set({ isActive: false, endedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
    this.debugLog(`Ended chat session ${sessionId}`);
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
  .where(sql`created_at < NOW() - INTERVAL '1 hour'`);

const rowCount = Array.isArray(deleted) ? deleted.length : 0;
this.debugLog(`Cleaned up ${rowCount} stale queue entries`);
return rowCount;
  }

  // Matching Algorithm
  async matchAllMoodQueueUsers(): Promise<MatchResult[]> {
    try {
      this.debugLog('Starting matching process');
      
      // Get all users who have been in queue for at least 1 second
      const allUsers: MoodQueue[] = await db.select()
        .from(moodQueue)
        .where(sql`created_at < NOW() - INTERVAL '1 second'`)
        .orderBy(asc(moodQueue.createdAt));

      this.debugLog(`Found ${allUsers.length} users in queue`, allUsers);

      const matches: MatchResult[] = [];
      const moodGroups = new Map<Mood, MoodQueue[]>();

      // Group by mood
      (allUsers as MoodQueue[]).forEach((user: MoodQueue) => {
        const mood = user.mood as Mood;
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

          this.debugLog(`Creating match for ${userA.userId} and ${userB.userId} (mood: ${mood})`);
          
          // Create session pair
          const sessionA = await this.createChatSession({
            userId: userA.userId,
            mood,
            partnerId: userB.userId
          });

          await this.createChatSession({
            userId: userB.userId,
            mood,
            partnerId: userA.userId
          });

          // Remove from queue
          await this.removeFromMoodQueue(userA.userId);
          await this.removeFromMoodQueue(userB.userId);

          matches.push({
            userA: userA.userId,
            userB: userB.userId,
            sessionId: sessionA.id
          });
        }

        // Handle unmatched user if any
        if (users.length === 1) {
          const unmatchedUser = users[0];
          this.debugLog(`Unmatched user ${unmatchedUser.userId} in mood group ${mood}`);
          // Optionally, implement logic to retry matching later or match with similar moods
          // For now, just keep the user in the queue
        }
      }

      this.debugLog(`Matching process complete. Matches:`, matches);
      return matches;
    } catch (error) {
      this.debugLog('Matching error:', error);
      throw error;
    }
  }

  // Stats & Monitoring
  async getMoodStats(): Promise<Record<Mood, number>> {
    try {
      // Using raw SQL query due to limitations in drizzle-orm typings
      const result = await db.execute<{ mood: Mood; count: string }>(`
        SELECT mood, COUNT(*) as count
        FROM mood_queue
        GROUP BY mood
      `);

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

      // @ts-ignore
      for (const row of result) {
        const mood = row.mood;
        const count = Number(row.count);
        if (mood in moodCounts) {
          moodCounts[mood] = count;
        }
      }

      this.debugLog('Fetched mood stats', moodCounts);
      return moodCounts;
    } catch (error) {
      console.error('Error fetching mood stats:', error);
      throw error;
    }
  }

  // Connection Tracking
  async addConnectedUser(userId: number, sessionId: number, mood: string): Promise<void> {
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

if (!updated || updated.length === 0) {
  await db.insert(connectedUsers)
    .values({ userId, sessionId, mood });
}
      this.debugLog(`Added/updated connected user ${userId} for session ${sessionId}`);
    } catch (error) {
      console.error('Connection tracking error:', error);
      // Non-critical error - don't break the match flow
    }
  }

  async markUserDisconnected(userId: number): Promise<void> {
    await db.update(connectedUsers)
      .set({ disconnectedAt: new Date() })
      .where(eq(connectedUsers.userId, userId));
    this.debugLog(`Marked user ${userId} as disconnected`);
  }

  async removeDisconnectedUsersFromMoodQueue(): Promise<void> {
    const disconnectedUsers = await db.select()
      .from(connectedUsers)
      .where(sql`disconnected_at IS NOT NULL`);

    await Promise.all(
      disconnectedUsers.map(user => 
        this.removeFromMoodQueue(user.userId)
      )
    );
    this.debugLog(`Removed ${disconnectedUsers.length} disconnected users from mood queue`);
  }
}

export const storage = new DatabaseStorage();