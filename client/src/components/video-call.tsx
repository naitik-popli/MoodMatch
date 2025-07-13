import React, { useEffect, useState, useRef } from "react";
import { Button } from "../components/ui/button";
import JitsiMeet from "../lib/jitsi.tsx";
import { Phone, AlertCircle } from "lucide-react";
import type { Mood } from "@shared/schema";
import useSocket from "../hooks/use-socket";

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
  sessionData: {
    sessionId: number;
    userId: number;
    partnerId: number;
    partnerSocketId?: string;
    role?: "initiator" | "receiver";
  };
  onCallEnd: () => void;
}


export default function VideoCall({ mood, sessionData, onCallEnd }: Props) {
  const [callDuration, setCallDuration] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "disconnected"
  >("connecting");
  const [callError, setCallError] = useState<string | null>(null);
  const [mediaPermissionDenied, setMediaPermissionDenied] = useState(false);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { socket, isConnected } = useSocket(sessionData.userId);

  // Format call duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };
  console.log("[VideoCall] Component mounted", sessionData);
  // Request media permissions on mount
  useEffect(() => {
    const requestMediaPermissions = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setConnectionStatus("connected");
      } catch (error) {
        setMediaPermissionDenied(true);
        setConnectionStatus("disconnected");
      }
    };
    requestMediaPermissions();
  }, []);

  // Handle call duration timer
  useEffect(() => {
    if (connectionStatus === "connected") {
      callTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    }
    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [connectionStatus]);

  // Error states
  if (callError) {
    return (
      <div className="fixed inset-0 bg-dark-blue z-50 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <h2 className="text-2xl font-bold mb-2 text-white text-center">
            Connection Error
          </h2>
          <p className="text-gray-300 mb-6 text-center">{callError}</p>
          <div className="flex flex-col space-y-3">
            <Button onClick={() => setCallError(null)} className="w-full">
              Retry Connection
            </Button>
            <Button
              onClick={onCallEnd}
              variant="outline"
              className="w-full text-white border-gray-600 hover:bg-gray-700"
            >
              Exit Call
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (mediaPermissionDenied) {
    return (
      <div className="fixed inset-0 bg-dark-blue z-50 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-yellow-500" />
          <h2 className="text-2xl font-bold mb-2 text-white text-center">
            Permission Required
          </h2>
          <p className="text-gray-300 mb-6 text-center">
            Please allow camera and microphone access in your browser settings.
          </p>
          <div className="flex flex-col space-y-3">
            <Button
              onClick={() => window.location.reload()}
              className="w-full"
            >
              Reload Page
            </Button>
            <Button
              onClick={onCallEnd}
              variant="outline"
              className="w-full text-white border-gray-600 hover:bg-gray-700"
            >
              Exit Call
            </Button>
          </div>
        </div>
      </div>
    );
  }

  console.log("[VideoCall] Rendering JitsiMeet", sessionData);

  // Render JitsiMeet component for video call
  return (
    <div className="fixed inset-0 bg-dark-blue z-50 flex flex-col">
      <div className="bg-dark-blue/90 backdrop-blur-sm border-b border-gray-700/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div
            className={`w-3 h-3 rounded-full animate-pulse ${
              connectionStatus === "connected"
                ? "bg-green-400"
                : connectionStatus === "connecting"
                ? "bg-yellow-400"
                : "bg-red-400"
            }`}
          />
          <span className="text-white text-sm font-medium">
            {connectionStatus === "connected"
              ? "Connected"
              : connectionStatus === "connecting"
              ? "Connecting..."
              : "Disconnected"}
          </span>
          <div className="text-white/60 text-sm ml-4">
            Both feeling:{" "}
            <span className="text-white font-medium">{MOOD_NAMES[mood]}</span>
          </div>
        </div>
        <div className="text-white/60 text-sm">{formatDuration(callDuration)}</div>
      </div>
      

     
      <JitsiMeet
        roomName={`MoodMatchRoom_${sessionData.sessionId}`}
        displayName={`User_${sessionData.userId}`}
      />
      

      <div className="bg-dark-blue/90 backdrop-blur-sm px-6 py-6 flex items-center justify-center space-x-6">
        <Button
          onClick={onCallEnd}
          className="w-16 h-16 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-lg"
        >
          <Phone className="text-xl" />
        </Button>
      </div>
    </div>
  );
}