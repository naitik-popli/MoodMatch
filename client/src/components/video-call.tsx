import React, { useEffect, useState, useRef } from "react";
import { Button } from "../components/ui/button";
import { 
  Mic, MicOff, Video, VideoOff, Phone, Settings, 
  Flag, Shuffle, Monitor 
} from "lucide-react";
import { useWebRTC } from "../hooks/use-webrtc";
import { useSocket } from "../hooks/use-socket";
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
    partnerId?: number;
    partnerSocketId?: string;
  };
  onCallEnd: () => void;
}

export default function VideoCall({ mood, sessionData, onCallEnd }: Props) {
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'reconnecting'>('connecting');
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  const { socket } = useSocket();
  const { 
    localStream, 
    remoteStream, 
    isConnected,
    startCall,
    endCall,
    toggleMute,
    toggleVideo 
  } = useWebRTC({
    socket,
    isInitiator: sessionData.partnerId ? sessionData.userId < sessionData.partnerId : false,
    targetSocketId: sessionData.partnerSocketId,
  });

  useEffect(() => {
    // Start the call when component mounts
    if (sessionData.partnerSocketId) {
      startCall();
    }
  }, [sessionData.partnerSocketId, startCall]);

  useEffect(() => {
    // Update connection status based on WebRTC connection
    if (isConnected) {
      setConnectionStatus('connected');
    } else {
      setConnectionStatus('connecting');
    }
  }, [isConnected]);

  useEffect(() => {
    // Set up call duration timer
    let timer: NodeJS.Timeout;
    if (connectionStatus === 'connected') {
      timer = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [connectionStatus]);

  useEffect(() => {
    // Set local video stream
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    // Set remote video stream
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!socket) return;

    // Listen for call end from partner
    socket.on('call-ended', (data) => {
      console.log('Call ended:', data.reason);
      onCallEnd();
    });

    return () => {
      socket.off('call-ended');
    };
  }, [socket, onCallEnd]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = async () => {
    try {
      // End WebRTC connection
      endCall();
      
      // End session on server
      await fetch(`/api/session/${sessionData.sessionId}/end`, {
        method: 'POST',
      });
      
      // Notify partner via socket
      if (socket) {
        socket.emit('end-call', {
          sessionId: sessionData.sessionId,
          partnerId: sessionData.partnerId,
        });
      }
      
      onCallEnd();
    } catch (error) {
      console.error('Error ending call:', error);
      onCallEnd(); // End anyway
    }
  };

  const handleToggleMute = () => {
    const newMutedState = toggleMute();
    setIsMuted(newMutedState);
  };

  const handleToggleVideo = () => {
    const newVideoState = toggleVideo();
    setIsVideoOff(!newVideoState);
  };

  const handleReport = () => {
    // TODO: Implement reporting functionality
    alert('Reporting functionality would be implemented here');
  };

  const handleNextChat = async () => {
    // End current call and find new match with same mood
    await handleEndCall();
    // Parent component will handle returning to mood selection
  };

  return (
    <div className="fixed inset-0 bg-dark-blue z-50">
      <div className="h-full flex flex-col">
        
        {/* Call Header */}
        <div className="bg-dark-blue/90 backdrop-blur-sm border-b border-gray-700/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full animate-pulse ${
                  connectionStatus === 'connected' ? 'bg-green-400' : 
                  connectionStatus === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
                }`}></div>
                <span className="text-white text-sm font-medium">
                  {connectionStatus === 'connected' ? 'Connected' : 
                   connectionStatus === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
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

        {/* Video Container */}
        <div className="flex-1 relative">
          {/* Remote Video */}
          <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                <div className="text-white text-center">
                  <div className="text-6xl mb-4">👤</div>
                  <div>Waiting for partner's video...</div>
                </div>
              </div>
            )}
            <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
              <Mic className="w-3 h-3 inline mr-1" />
              Partner
            </div>
          </div>

          {/* Local Video */}
          <div className="absolute bottom-6 right-6 w-48 h-36 bg-gray-700 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!localStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-700">
                <div className="text-white text-xs">No video</div>
              </div>
            )}
            <div className="absolute top-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
              You
            </div>
          </div>

          {/* Connection Status */}
          {connectionStatus !== 'connected' && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white px-4 py-2 rounded-lg">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                <span className="text-sm">
                  {connectionStatus === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Call Controls */}
        <div className="bg-dark-blue/90 backdrop-blur-sm px-6 py-6">
          <div className="flex items-center justify-center space-x-6">
            
            <Button
              onClick={handleToggleMute}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
              variant="ghost"
            >
              {isMuted ? <MicOff className="text-lg" /> : <Mic className="text-lg" />}
            </Button>

            <Button
              onClick={handleToggleVideo}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
              variant="ghost"
            >
              {isVideoOff ? <VideoOff className="text-lg" /> : <Video className="text-lg" />}
            </Button>

            <Button
              onClick={handleEndCall}
              className="w-16 h-16 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-colors shadow-lg"
            >
              <Phone className="text-xl" />
            </Button>

            <Button
              className="w-14 h-14 bg-gray-700 hover:bg-gray-600 text-white rounded-full flex items-center justify-center transition-colors"
              variant="ghost"
            >
              <Monitor className="text-lg" />
            </Button>

            <Button
              className="w-14 h-14 bg-gray-700 hover:bg-gray-600 text-white rounded-full flex items-center justify-center transition-colors"
              variant="ghost"
            >
              <Settings className="text-lg" />
            </Button>

          </div>

          {/* Call Actions */}
          <div className="flex items-center justify-center space-x-4 mt-4">
            <Button
              onClick={handleReport}
              variant="ghost"
              className="text-white/60 hover:text-white text-sm flex items-center space-x-2"
            >
              <Flag className="w-3 h-3" />
              <span>Report</span>
            </Button>
            <Button
              onClick={handleNextChat}
              variant="ghost"
              className="text-white/60 hover:text-white text-sm flex items-center space-x-2"
            >
              <Shuffle className="w-3 h-3" />
              <span>Next Chat</span>
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
