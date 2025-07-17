import React, { useState, useEffect, useRef, useCallback } from "react";
import { Settings } from "lucide-react";
import MoodSelection from "../components/mood-selection";
import WaitingRoom from "../components/waiting-room";
import VideoCall from "../components/video-call";
import SettingsModal from "../components/settings-modal";
import { useSocket } from "../hooks/use-socket";
import type { Mood } from "@shared/schema";
import { API_BASE_URL } from "../lib/api";
import TestCallConnection from "../components/TestCallConnection";

export default function MoodChat() {
  const [currentScreen, setCurrentScreen] = useState<'selection' | 'waiting' | 'call'>('selection');
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionData, setSessionData] = useState<{
    sessionId: number;
    userId: number;
    partnerId?: number;
    role?: "initiator" | "receiver";
  } | null>(null);

  // UseSocket: just pass the wsUrl
  const { socket, isConnected, emit, on } = useSocket("wss://moodmatch-1.onrender.com");
  console.log("🔗 Socket connection status:", isConnected);

  const alreadyMatched = useRef(false);

  // Handle match-found event from backend
  const handleMatchFound = useCallback((data: { role: "initiator" | "receiver"; partnerId: number; sessionId: number }) => {
    console.log("🧩 handleMatchFound called with data:", data);

    setSessionData((prev) => {
      if (!prev) {
        console.warn("⚠️ No session to update on match-found");
        return null;
      }
      if (alreadyMatched.current) {
        console.warn("⚠️ Already matched, ignoring duplicate match-found event");
        // Reset matched state to allow new matches if sessionId differs
        if (prev.sessionId !== data.sessionId) {
          console.log("ℹ️ New session detected, resetting matched state");
          alreadyMatched.current = false;
        } else {
          return prev; // Ignore duplicate matches
        }
      }
      alreadyMatched.current = true;
      const updated = {
        ...prev,
        role: data.role,
        partnerId: data.partnerId,
        sessionId: data.sessionId,
      };

      console.log("📦 Updated sessionData after match:", updated);
      setCurrentScreen("call");
      return updated;
    });
  }, []);

  useEffect(() => {
    if (currentScreen === 'call') {
      console.log("📞 Transitioning to VideoCall:", sessionData);
    }
  }, [currentScreen, sessionData]);

  // Listen for match-found messages from backend
  useEffect(() => {
    if (!socket) return;
    const off = on("message", (msg) => {
      if (msg && typeof msg === "object" && msg.type === "match-found") {
        handleMatchFound(msg);
      }
    });
    return off;
  }, [socket, on, handleMatchFound]);

  // Handle mood selection and session creation
  const handleMoodSelect = async (mood: Mood) => {
    try {
      const response = await fetch(`${API_BASE_URL}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood }),
      });

      if (!response.ok) throw new Error('Failed to create session');

      const data = await response.json();

      console.log("🎉 Session created:", data);

      setSessionData({
        sessionId: data.sessionId,
        userId: data.userId,
        partnerId: data.partnerId,
        role: undefined,
      });
      localStorage.setItem("userId", String(data.userId));
      setSelectedMood(mood);
      setCurrentScreen('waiting');

      // Join queue via WebSocket
      if (emit && data.userId && data.sessionId) {
        console.log("📤 Emitting join-queue");
        emit({ type: "join-queue", userId: data.userId, mood });
      } else {
        console.warn("⚠️ Cannot emit join-queue — socket or session info missing");
      }
    } catch (error) {
      console.error('❌ Error selecting mood:', error);
    }
  };

  // Handle call end
  const handleCallEnd = () => {
    console.log("📞 Call ended");
    alreadyMatched.current = false; // Reset matched state to allow new matches
    setCurrentScreen('selection');
    setSelectedMood(null);
    setSessionData(null);
  };

  // Handle cancel waiting
  const handleCancelWaiting = () => {
    console.log("🚫 Cancelled waiting");
    if (emit && sessionData?.userId) {
      emit({ type: "leave-queue", userId: sessionData.userId });
    }
    setCurrentScreen('selection');
    setSelectedMood(null);
    setSessionData(null);
  };

  // UI: loading if userId not set in waiting
  const userId = localStorage.getItem("userId");
  if (currentScreen === "waiting" && !userId) {
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
                <span className="text-white text-sm">💗</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">MoodChat</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="hidden sm:block text-sm text-gray-600">
                <span className="inline-flex items-center">
                  <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-success' : 'bg-red-500'}`}></div>
                  {isConnected ? 'Connected' : 'Connecting...'}
                </span>
              </div>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setShowSettings(true)}
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      {currentScreen === 'selection' && (
        <MoodSelection onMoodSelect={handleMoodSelect} />
      )}

      {currentScreen === 'waiting' && selectedMood && (
        <WaitingRoom
          mood={selectedMood}
          onCancel={handleCancelWaiting}
          onMatchFound={handleMatchFound}
          onResetQueueJoin={() => {}}
        />
      )}

      {currentScreen === 'call' && selectedMood && sessionData && (
        <VideoCall
          mood={selectedMood}
          sessionData={sessionData}
          onCallEnd={handleCallEnd}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* Test Call Connection Component */}
      <TestCallConnection />
    </div>
  );
}