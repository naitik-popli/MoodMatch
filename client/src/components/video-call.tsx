import React, { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "../components/ui/button";
import { 
  Mic, MicOff, Video, VideoOff, Phone, Settings, 
  Flag, Shuffle, Monitor, Loader2, AlertCircle
} from "lucide-react";
import { useWebRTC } from "../hooks/use-webrtc";
import { useSocket } from "../hooks/use-socket";
import type { Mood } from "@shared/schema";

// Debugging with timestamp
const debug = (context: string) => (...args: any[]) => {
  console.log(`[${new Date().toISOString()}] [DEBUG:${context}]`, ...args);
};

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
  const log = debug('VideoCall');
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [webRTCSupported, setWebRTCSupported] = useState(true);
  const [mediaPermissionDenied, setMediaPermissionDenied] = useState(false);
  // Added missing state for mediaPermissionGranted
  const [mediaPermissionGranted, setMediaPermissionGranted] = useState(false);
  const { socket } = useSocket(sessionData.userId);
  const [callError, setCallError] = useState<string | null>(null);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);

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

  // Initialize call
  const initializeCall = useCallback(async () => {
    if (!webRTCSupported || !sessionData.partnerSocketId) return;

    log('Starting call initialization');
    setIsStartingCall(true);
    setConnectionStatus('connecting');

    try {
      await startCall();
      log('Call started successfully');
    } catch (error) {
      log('Call initialization failed:', error);
      setConnectionStatus('disconnected');
      setCallError('Failed to establish connection');
    } finally {
      setIsStartingCall(false);
    }
  }, [webRTCSupported, sessionData.partnerSocketId, startCall, log]);

  // Attach stream to video element
  const attachStream = useCallback((stream: MediaStream | null, isLocal: boolean) => {
    const videoEl = isLocal ? localVideoRef.current : remoteVideoRef.current;
    if (!videoEl) return;

    // Clean up previous stream if exists
    if (videoEl.srcObject) {
      (videoEl.srcObject as MediaStream).getTracks().forEach(track => track.stop());
    }

    if (stream) {
      videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl.muted = isLocal;

      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          log(`${isLocal ? 'Local' : 'Remote'} video play failed:`, err);
          if (isLocal) setNeedsUserInteraction(true);
        });
      }

      videoEl.onloadedmetadata = () => {
        log(`${isLocal ? 'Local' : 'Remote'} video metadata loaded`);
      };

      videoEl.onplaying = () => {
        log(`${isLocal ? 'Local' : 'Remote'} video playing`);
        setNeedsUserInteraction(false);
        if (isLocal) {
          setMediaPermissionGranted(true);
        }
      };

      // Added: listen for pause event to detect interruptions
      videoEl.onpause = () => {
        log(`${isLocal ? 'Local' : 'Remote'} video paused`);
        if (isLocal) setMediaPermissionDenied(true);
      };
    } else {
      videoEl.srcObject = null;
    }
  }, [log]);

  // Handle stream changes
  useEffect(() => {
    attachStream(localStream, true);
  }, [localStream, attachStream]);

  useEffect(() => {
    attachStream(remoteStream, false);
  }, [remoteStream, attachStream]);

  // Handle connection state changes
  useEffect(() => {
    if (isConnected) {
      setConnectionStatus('connected');
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setConnectionStatus(prev => prev === 'connecting' ? 'connecting' : 'disconnected');
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [isConnected]);

  // Click-to-play handler
  const handleVideoClick = useCallback(async () => {
    if (localVideoRef.current) {
      try {
        await localVideoRef.current.play();
        log('Manual playback started');
      } catch (err) {
        log('Manual playback failed:', err);
      }
    }
  }, [log]);

  // Toggle mute
  const handleToggleMute = useCallback(() => {
    try {
      const newMutedState = toggleMute();
      setIsMuted(newMutedState);
    } catch (error) {
      log('Failed to toggle audio:', error);
    }
  }, [toggleMute, log]);

  // Toggle video
  const handleToggleVideo = useCallback(() => {
    try {
      const newVideoState = toggleVideo();
      setIsVideoOff(!newVideoState);
    } catch (error) {
      log('Failed to toggle video:', error);
    }
  }, [toggleVideo, log]);

  // End call
  const handleEndCall = useCallback(async () => {
    log('User initiated call end');
    try {
      await endCall();
      if (socket) {
        socket.emit('end-call', { 
          sessionId: sessionData.sessionId, 
          partnerId: sessionData.partnerId 
        });
      }
      onCallEnd();
    } catch (error) {
      log('Error ending call:', error);
    }
  }, [endCall, socket, sessionData, onCallEnd, log]);

  // Report and next chat handlers
  const handleReport = () => {
    log('User reported partner');
    alert('Report submitted. Our team will review this call.');
  };

  const handleNextChat = async () => {
    log('User requested next chat');
    await handleEndCall();
  };

  // Initial setup
  useEffect(() => {
    checkWebRTCAvailability();
  }, [checkWebRTCAvailability]);

  // Explicitly request media permissions on mount
  useEffect(() => {
    const requestMediaPermissions = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setMediaPermissionGranted(true);
      } catch (error) {
        setMediaPermissionDenied(true);
      }
    };

    requestMediaPermissions();
  }, []);

  useEffect(() => {
    if (socket && socket.connected) {
      initializeCall();
    }
  }, [socket, initializeCall]);

  useEffect(() => {
    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
  if (
    webRTCSupported &&
    mediaPermissionGranted &&
    sessionData.partnerSocketId &&
    socket
  ) {
    initializeCall();
  } else {
    log('Waiting for socket, media permissions, or partnerSocketId', {
      socketReady: !!socket,
      mediaPermissionGranted,
      partnerSocketId: sessionData.partnerSocketId,
    });
  }
}, [webRTCSupported, mediaPermissionGranted, sessionData.partnerSocketId, socket]);


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
            {callError?.includes('HTTPS') ? (
              <Button asChild className="w-full">
                <a href={`https://${window.location.host}${window.location.pathname}`}>
                  Switch to HTTPS
                </a>
              </Button>
            ) : (
              <Button 
                onClick={() => {
                  setCallError(null);
                  if (checkWebRTCAvailability()) initializeCall();
                }} 
                className="w-full"
              >
                Retry Connection
              </Button>
            )}
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

  return (
    <div className="fixed inset-0 bg-dark-blue z-50">
      {/* Debug overlay */}
      <div className="absolute top-4 left-4 bg-black/70 text-white p-2 text-xs z-50 rounded">
        <div>Local: {localStream?.id ? '✅' : '❌'}</div>
        <div>Remote: {remoteStream?.id ? '✅' : '❌'}</div>
        <button 
          onClick={() => console.log({
            localStream: localStream?.getTracks().map(t => t.readyState),
            remoteStream: remoteStream?.getTracks().map(t => t.readyState)
          })}
          className="mt-1 text-blue-300"
        >
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

        {/* Main video area */}
        <div className="flex-1 relative bg-gray-800 overflow-hidden">
          {/* Remote video */}
          <div className="absolute inset-0">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover bg-black"
            />
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              </div>
            )}
          </div>

          {/* Local video */}
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
            {needsUserInteraction && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <button className="text-white text-sm bg-blue-500 px-3 py-1 rounded">
                  Click to Start
                </button>
              </div>
            )}
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

            <Button
              className="w-14 h-14 bg-gray-700 hover:bg-gray-600"
              variant="ghost"
              disabled={connectionStatus !== 'connected'}
            >
              <Monitor className="text-lg" />
            </Button>

            <Button
              className="w-14 h-14 bg-gray-700 hover:bg-gray-600"
              variant="ghost"
              disabled={connectionStatus !== 'connected'}
            >
              <Settings className="text-lg" />
            </Button>
          </div>

          <div className="flex items-center justify-center space-x-4 mt-4">
            <Button
              onClick={handleReport}
              variant="ghost"
              className="text-white/60 hover:text-white text-sm"
            >
              <Flag className="w-3 h-3 mr-2" /> Report
            </Button>
            <Button
              onClick={handleNextChat}
              variant="ghost"
              className="text-white/60 hover:text-white text-sm"
            >
              <Shuffle className="w-3 h-3 mr-2" /> Next Chat
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}