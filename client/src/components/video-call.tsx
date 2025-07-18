import React, { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "../components/ui/button";
import { Mic, MicOff, Video, VideoOff, Phone, Settings, Flag, Shuffle, Monitor, Loader2, AlertCircle } from "lucide-react";
import { useWebRTC } from "../hooks/use-webrtc";
import type { Mood } from "@shared/schema";

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
    role?: "initiator" | "receiver";
    externalLocalStream?: MediaStream;
  };
  onCallEnd: () => void;
}

export default function VideoCall({ mood, sessionData, onCallEnd }: Props) {
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [webRTCSupported, setWebRTCSupported] = useState(true);
  const [mediaPermissionDenied, setMediaPermissionDenied] = useState(false);
  const [mediaPermissionGranted, setMediaPermissionGranted] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Use the new WebSocket-based useWebRTC hook
  const { 
    localStream, 
    remoteStream, 
    isConnected,
    endCall,
    toggleMute,
    toggleVideo 
  } = useWebRTC({
  isInitiator: sessionData.role === "initiator",
  externalLocalStream: sessionData.externalLocalStream,
});

  // Format call duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // WebRTC availability check
  const checkWebRTCAvailability = useCallback(() => {
    const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    const hasMediaDevices = !!(navigator.mediaDevices?.getUserMedia);
    const hasRTCPeerConnection = !!window.RTCPeerConnection;
    if (!isSecure) {
      setCallError('Video calling requires HTTPS or localhost for security.');
      return false;
    }
    if (!hasMediaDevices || !hasRTCPeerConnection) {
      setCallError('Your browser does not support required video calling features.');
      return false;
    }
    return true;
  }, []);

  // Attach stream to video element
  const attachStream = useCallback((stream: MediaStream | null, isLocal: boolean) => {
    const videoEl = isLocal ? localVideoRef.current : remoteVideoRef.current;
    if (!videoEl) return;
    if (videoEl.srcObject !== stream) {
      if (videoEl.srcObject && videoEl.srcObject !== stream) {
        (videoEl.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
      if (stream) {
        videoEl.srcObject = stream;
        videoEl.playsInline = true;
        videoEl.muted = isLocal;
        videoEl.play().catch(() => setNeedsUserInteraction(true));
      } else {
        videoEl.srcObject = null;
      }
    }
  }, []);

  // Attach streams on change
  useEffect(() => { attachStream(localStream, true); }, [localStream, attachStream]);
  useEffect(() => { attachStream(remoteStream, false); }, [remoteStream, attachStream]);
  useEffect(() => {
  console.log("[VideoCall] sessionData", sessionData);
  console.log("[VideoCall] mood", mood);
}, [sessionData, mood]);
  // Handle connection state changes
  useEffect(() => {
    if (isConnected) {
      setConnectionStatus('connected');
      callTimerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    } else {
      setConnectionStatus(prev => prev === 'connecting' ? 'connecting' : 'disconnected');
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    }
    return () => { if (callTimerRef.current) clearInterval(callTimerRef.current); };
  }, [isConnected]);

  // Click-to-play handler
  const handleVideoClick = useCallback(async () => {
    if (localVideoRef.current) {
      try {
        await localVideoRef.current.play();
      } catch {}
    }
  }, []);

  // Toggle mute
  const handleToggleMute = useCallback(() => {
    try {
      const newMutedState = toggleMute();
      setIsMuted(newMutedState);
    } catch {}
  }, [toggleMute]);

  // Toggle video
  const handleToggleVideo = useCallback(() => {
    try {
      const newVideoState = toggleVideo();
      setIsVideoOff(!newVideoState);
    } catch {}
  }, [toggleVideo]);

  // End call
  const handleEndCall = useCallback(async () => {
    try {
      await endCall();
      onCallEnd();
    } catch {}
  }, [endCall, onCallEnd]);

  // Report and next chat handlers
  const handleReport = () => {
    alert('Report submitted. Our team will review this call.');
  };
  const handleNextChat = async () => {
    await handleEndCall();
  };

  // Initial setup
  useEffect(() => { checkWebRTCAvailability(); }, [checkWebRTCAvailability]);
  useEffect(() => {
    const requestMediaPermissions = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setMediaPermissionGranted(true);
      } catch {
        setMediaPermissionDenied(true);
      }
    };
    requestMediaPermissions();
  }, []);

  // Error states
  if (!webRTCSupported || callError) {
    return (
      <div className="fixed inset-0 bg-dark-blue z-50 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <h2 className="text-2xl font-bold mb-2 text-white text-center">
            {!webRTCSupported ? 'Browser Not Supported' : 'Connection Error'}
          </h2>
          <p className="text-gray-300 mb-6 text-center">
            {!webRTCSupported 
              ? 'Please use the latest Chrome, Firefox, or Edge with HTTPS.'
              : callError}
          </p>
          <div className="flex flex-col space-y-3">
            <Button onClick={onCallEnd} variant="outline" className="w-full text-white border-gray-600 hover:bg-gray-700">
              Exit Call
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-dark-blue z-50">
      {/* Debug overlay */}
      <div className="absolute top-4 left-4 bg-black/70 text-white p-2 text-xs z-50 rounded">
        <div>Local: {localStream?.id ? '✅' : '❌'}</div>
        <div>Local Tracks: {localStream?.getTracks().map(t => `${t.kind}:${t.readyState}`).join(', ') || '—'}</div>
        <div>Remote: {remoteStream?.id ? '✅' : '❌'}</div>
        <button onClick={() => console.log({ localStream, remoteStream })} className="mt-1 text-blue-300">
          Debug Streams
        </button>
      </div>

      <div className="h-full flex flex-col">
        {/* Call Header */}
        <div className="bg-dark-blue/90 backdrop-blur-sm border-b border-gray-700/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full animate-pulse ${
                  connectionStatus === 'connected' ? 'bg-green-400' : 
                  connectionStatus === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
                }`} />
                <span className="text-white text-sm font-medium">
                  {connectionStatus === 'connected' ? 'Connected' : 
                   connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
                </span>
              </div>
              <div className="text-white/60 text-sm">
                Both feeling: <span className="text-white font-medium">{MOOD_NAMES[mood]}</span>
              </div>
            </div>
            <div className="text-white/60 text-sm">
              {formatDuration(callDuration)}
            </div>
          </div>
        </div>

        <div className="flex-1 relative bg-gray-800 overflow-hidden">
          {/* Remote video */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover bg-black"
            onClick={() => remoteVideoRef.current?.play()}
          />
          {!remoteStream && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            </div>
          )}

          {/* Local video overlay */}
          <div 
            className={`absolute bottom-6 right-6 w-48 h-36 rounded-xl overflow-hidden shadow-2xl border-2 ${
              needsUserInteraction ? 'border-yellow-500 animate-pulse' : 'border-white/20'
            }`}
            onClick={handleVideoClick}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover bg-black"
              style={{ transform: 'rotateY(180deg)' }}
            />
          </div>
        </div>

        {/* Call Controls */}
        <div className="bg-dark-blue/90 backdrop-blur-sm px-6 py-6">
          <div className="flex items-center justify-center space-x-6">
            <Button
              onClick={handleToggleMute}
              disabled={connectionStatus !== 'connected'}
              className={`w-14 h-14 rounded-full ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              variant="ghost"
            >
              {isMuted ? <MicOff className="text-lg" /> : <Mic className="text-lg" />}
            </Button>

            <Button
              onClick={handleToggleVideo}
              disabled={connectionStatus !== 'connected'}
              className={`w-14 h-14 rounded-full ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              variant="ghost"
            >
              {isVideoOff ? <VideoOff className="text-lg" /> : <Video className="text-lg" />}
            </Button>

            <Button
              onClick={handleEndCall}
              className="w-16 h-16 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-lg"
            >
              <Phone className="text-xl" />
            </Button>

            <Button className="w-14 h-14 bg-gray-700 hover:bg-gray-600" variant="ghost" disabled>
              <Monitor className="text-lg" />
            </Button>
            <Button className="w-14 h-14 bg-gray-700 hover:bg-gray-600" variant="ghost" disabled>
              <Settings className="text-lg" />
            </Button>
          </div>

          <div className="flex items-center justify-center space-x-4 mt-4">
            <Button onClick={handleReport} variant="ghost" className="text-white/60 hover:text-white text-sm">
              <Flag className="w-3 h-3 mr-2" /> Report
            </Button>
            <Button onClick={handleNextChat} variant="ghost" className="text-white/60 hover:text-white text-sm">
              <Shuffle className="w-3 h-3 mr-2" /> Next Chat
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}