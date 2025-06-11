import { Server as SocketIOServer, Socket } from "socket.io";
import { storage } from "./storage";
import type { Mood } from "@shared/schema";

interface SocketData {
  userId?: number;
  mood?: Mood;
  sessionId?: number;
  partnerId?: number;
}

export function setupWebSocket(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    console.log("Client connected:", socket.id);

    // Join mood matching queue
    socket.on("join-mood-queue", async (data: { userId: number; mood: Mood; sessionId: number }) => {
      try {
        const { userId, mood, sessionId } = data;
        
        // Store user data in socket
        socket.data = { userId, mood, sessionId } as SocketData;
        
        // Add to mood queue
        await storage.addToMoodQueue({
          userId,
          mood,
          socketId: socket.id,
        });

        // Try to find a match
        const match = await storage.findMoodMatch(userId, mood);
        
        if (match) {
          // Found a match - notify both users
          const partnerSocket = io.sockets.sockets.get(match.socketId);
          
          if (partnerSocket) {
            // Update both sessions with partner info
            await storage.updateChatSessionPartner(sessionId, match.userId);
            await storage.updateChatSessionPartner(match.sessionId!, userId);
            
            // Remove both from queue
            await storage.removeFromMoodQueue(userId);
            await storage.removeFromMoodQueue(match.userId);
            
            // Notify both clients about the match
            socket.emit("match-found", {
              partnerId: match.userId,
              partnerSocketId: match.socketId,
              sessionId: sessionId,
            });
            
            partnerSocket.emit("match-found", {
              partnerId: userId,
              partnerSocketId: socket.id,
              sessionId: match.sessionId,
            });
            
            console.log(`Matched users ${userId} and ${match.userId} for mood: ${mood}`);
          }
        } else {
          // No match found, user is in queue
          socket.emit("waiting-for-match", { mood });
        }
      } catch (error) {
        console.error("Error joining mood queue:", error);
        socket.emit("error", { message: "Failed to join mood queue" });
      }
    });

    // Leave mood queue
    socket.on("leave-mood-queue", async () => {
      try {
        if (socket.data?.userId) {
          await storage.removeFromMoodQueue(socket.data.userId);
          socket.emit("left-queue");
        }
      } catch (error) {
        console.error("Error leaving mood queue:", error);
      }
    });

    // WebRTC signaling
    socket.on("webrtc-offer", (data: { targetSocketId: string; offer: any }) => {
      const targetSocket = io.sockets.sockets.get(data.targetSocketId);
      if (targetSocket) {
        targetSocket.emit("webrtc-offer", {
          fromSocketId: socket.id,
          offer: data.offer,
        });
      }
    });

    socket.on("webrtc-answer", (data: { targetSocketId: string; answer: any }) => {
      const targetSocket = io.sockets.sockets.get(data.targetSocketId);
      if (targetSocket) {
        targetSocket.emit("webrtc-answer", {
          fromSocketId: socket.id,
          answer: data.answer,
        });
      }
    });

    socket.on("webrtc-ice-candidate", (data: { targetSocketId: string; candidate: any }) => {
      const targetSocket = io.sockets.sockets.get(data.targetSocketId);
      if (targetSocket) {
        targetSocket.emit("webrtc-ice-candidate", {
          fromSocketId: socket.id,
          candidate: data.candidate,
        });
      }
    });

    // Handle call end
    socket.on("end-call", async (data: { sessionId: number; partnerId?: number }) => {
      try {
        if (data.sessionId) {
          await storage.endChatSession(data.sessionId);
        }
        
        // Notify partner if they exist
        if (socket.data?.partnerId) {
          const partnerSockets = Array.from(io.sockets.sockets.values())
            .filter(s => s.data?.userId === socket.data?.partnerId);
          
          partnerSockets.forEach(partnerSocket => {
            partnerSocket.emit("call-ended", { reason: "Partner ended call" });
          });
        }
        
        socket.emit("call-ended", { reason: "Call ended successfully" });
      } catch (error) {
        console.error("Error ending call:", error);
      }
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      console.log("Client disconnected:", socket.id);
      
      try {
        if (socket.data?.userId) {
          // Remove from queue if they were waiting
          await storage.removeFromMoodQueue(socket.data.userId);
          
          // End active session if they were in a call
          if (socket.data.sessionId) {
            await storage.endChatSession(socket.data.sessionId);
          }
          
          // Notify partner if they exist
          if (socket.data.partnerId) {
            const partnerSockets = Array.from(io.sockets.sockets.values())
              .filter(s => s.data?.userId === socket.data?.partnerId);
            
            partnerSockets.forEach(partnerSocket => {
              partnerSocket.emit("call-ended", { reason: "Partner disconnected" });
            });
          }
        }
      } catch (error) {
        console.error("Error handling disconnect:", error);
      }
    });
  });
}
