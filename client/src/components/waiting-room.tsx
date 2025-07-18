import React, { useEffect, useState, useRef } from "react";
import { Button } from "../components/ui/button";
import { useWebSocket } from "../context/WebSocketContext";
import type { Mood } from "@shared/schema";

// Emojis for each mood
const MOOD_EMOJIS: Record<Mood, string> = {
  happy: "😊",
  relaxed: "😌",
  energetic: "⚡",
  thoughtful: "🤔",
  creative: "🎨",
  adventurous: "🌟",
  nostalgic: "💭",
  curious: "🔍",
};

// Mood display names
const MOOD_NAMES: Record<Mood, string> = {
  happy: "Happy",
  relaxed: "Relaxed",
  energetic: "Energetic",
  thoughtful: "Thoughtful",
  creative: "Creative",
  adventurous: "Adventurous",
  nostalgic: "Nostalgic",
  curious: "Curious",
};

interface Props {
  mood: Mood;
  onCancel: () => void;
  onMatchFound: (data: {
    role: "initiator" | "receiver";
    partnerId: number;
    sessionId: number;
  }) => void;
  onResetQueueJoin: () => void;
}

export default function WaitingRoom({ mood, onCancel, onMatchFound, onResetQueueJoin }: Props) {
  const [waitTime, setWaitTime] = useState(0);
  const [userId, setUserId] = useState<number | null>(null);
  const { ws, socketId } = useWebSocket();
  const [hasJoinedQueue, setHasJoinedQueue] = useState(false);
  const hasLeftQueue = useRef(false);

  // Load userId from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("userId");
    if (stored) {
      setUserId(Number(stored));
      console.log("[WaitingRoom] Loaded userId from localStorage:", stored);
    } else {
      console.warn("⚠️ userId not found in localStorage");
    }
  }, []);

  // Timer for UI, reset on mood change
  useEffect(() => {
    setWaitTime(0);
    const timer = setInterval(() => {
      setWaitTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [mood]);

  // Reset hasJoinedQueue when mood changes
  useEffect(() => {
    setHasJoinedQueue(false);
    hasLeftQueue.current = false;
  }, [mood]);

  // Function to leave queue (idempotent)
  const leaveQueue = () => {
    if (hasLeftQueue.current) return;
    hasLeftQueue.current = true;
    if (ws && ws.readyState === WebSocket.OPEN && userId && hasJoinedQueue) {
      console.log(`[WaitingRoom] Sending leave-queue for user ${userId}`);
      ws.send(JSON.stringify({ type: "leave-queue", userId }));
      setHasJoinedQueue(false);
      onResetQueueJoin?.();
    }
  };

  // Join queue and listen for match-found
  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !userId || !mood || hasJoinedQueue) {
      if (!ws) console.log("[WaitingRoom] WebSocket not ready yet");
      if (ws && ws.readyState !== WebSocket.OPEN) console.log("[WaitingRoom] WebSocket not connected yet");
      if (!userId) console.log("[WaitingRoom] userId not set yet");
      if (hasJoinedQueue) console.log("[WaitingRoom] Already joined queue");
      return;
    }

    let offMatch: (() => void) | undefined;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          console.warn("Media devices API not supported in this browser.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(track => track.stop());

        setTimeout(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            console.log("[WaitingRoom] Emitting join-queue:", { userId, mood });
            ws.send(JSON.stringify({ type: "join-queue", userId, mood }));
            setHasJoinedQueue(true);
          } else {
            console.warn("[WaitingRoom] ws not available or not open");
          }
        }, 300);
      } catch (error) {
        console.error("Media devices access error:", error);
      }
    })();

    // Listen for match-found messages
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data === "object" && data.type === "match-found") {
          console.log("[WaitingRoom] match-found received:", data);
          onMatchFound({
            role: data.role,
            partnerId: data.partnerId,
            sessionId: data.sessionId,
          });
        }
      } catch (err) {
        // Ignore non-JSON messages
      }
    };

    ws.addEventListener("message", handleMessage);
    offMatch = () => ws.removeEventListener("message", handleMessage);

    return () => {
      offMatch?.();
      console.log("[WaitingRoom] Cleaned up WebSocket listeners");
    };
  }, [ws, userId, mood, onMatchFound, hasJoinedQueue]);

  // Leave queue on unmount or page reload
  useEffect(() => {
    const handleBeforeUnload = () => leaveQueue();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      leaveQueue();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [ws, userId, hasJoinedQueue]);

  // Handle cancel button click
  const handleCancel = () => {
    leaveQueue();
    onCancel();
  };

  // Format timer into mm:ss
  const formatWaitTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getEstimatedWait = () => {
    if (waitTime < 30) return "~30 seconds";
    if (waitTime < 60) return "~1 minute";
    if (waitTime < 120) return "~2 minutes";
    return "~3 minutes";
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-primary to-secondary flex items-center justify-center z-50">
      <div className="text-center text-white max-w-md mx-auto px-6">
        <div className="relative mb-8">
          <div className="w-32 h-32 mx-auto rounded-full bg-white/20 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-white/30 flex items-center justify-center">
              <div className="text-4xl float">{MOOD_EMOJIS[mood]}</div>
            </div>
          </div>
          <div className="absolute inset-0 w-32 h-32 mx-auto rounded-full border-4 border-white/30 pulse-ring"></div>
        </div>

        <h3 className="text-2xl font-bold mb-4">Finding your mood match...</h3>
        <p className="text-white/80 mb-6">
          We're looking for someone else feeling{" "}
          <span className="font-semibold">{MOOD_NAMES[mood].toLowerCase()}</span>{" "}
          to chat with you.
        </p>

        <div className="flex items-center justify-center space-x-2 mb-8">
          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "0s" }}></div>
          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "0.4s" }}></div>
        </div>

        <div className="bg-white/10 rounded-lg p-4 mb-6">
          <div className="text-sm text-white/80 mb-2">Waiting time</div>
          <div className="text-lg font-semibold">{formatWaitTime(waitTime)}</div>
          <div className="text-sm text-white/60 mt-1">Estimated: {getEstimatedWait()}</div>
        </div>

        <Button
          variant="ghost"
          onClick={handleCancel}
          className="text-white/80 hover:text-white hover:bg-white/10"
        >
          Cancel and choose different mood
        </Button>
      </div>
    </div>
  );
}