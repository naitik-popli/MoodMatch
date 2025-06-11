import React, { useState } from "react";
import { Settings } from "lucide-react";
import MoodSelection from "@/components/mood-selection";
import WaitingRoom from "@/components/waiting-room";
import VideoCall from "@/components/video-call";
import SettingsModal from "@/components/settings-modal";
import { useSocket } from "@/hooks/use-socket";
import type { Mood } from "@shared/schema";

export default function MoodChat() {
  const [currentScreen, setCurrentScreen] = useState<'selection' | 'waiting' | 'call'>('selection');
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionData, setSessionData] = useState<{
    sessionId: number;
    userId: number;
    partnerId?: number;
    partnerSocketId?: string;
  } | null>(null);

  const { socket, isConnected } = useSocket();

  const handleMoodSelect = async (mood: Mood) => {
    try {
      // Create session
      const response = await fetch('/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood }),
      });
      
      if (!response.ok) throw new Error('Failed to create session');
      
      const data = await response.json();
      setSessionData({
        sessionId: data.sessionId,
        userId: data.userId,
      });
      
      setSelectedMood(mood);
      setCurrentScreen('waiting');
      
      // Join mood queue via socket
      if (socket) {
        socket.emit('join-mood-queue', {
          userId: data.userId,
          mood,
          sessionId: data.sessionId,
        });
      }
    } catch (error) {
      console.error('Error selecting mood:', error);
    }
  };

  const handleMatchFound = (data: { partnerId: number; partnerSocketId: string }) => {
    setSessionData(prev => prev ? {
      ...prev,
      partnerId: data.partnerId,
      partnerSocketId: data.partnerSocketId,
    } : null);
    setCurrentScreen('call');
  };

  const handleCallEnd = () => {
    setCurrentScreen('selection');
    setSelectedMood(null);
    setSessionData(null);
  };

  const handleCancelWaiting = () => {
    if (socket && sessionData) {
      socket.emit('leave-mood-queue');
    }
    setCurrentScreen('selection');
    setSelectedMood(null);
    setSessionData(null);
  };

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
    </div>
  );
}
