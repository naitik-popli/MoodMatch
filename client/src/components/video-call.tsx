import React, { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "../components/ui/button";
import { 
  Mic, MicOff, Video, VideoOff, Phone, Settings, 
  Flag, Shuffle, Monitor, Loader2, AlertCircle
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
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [webRTCSupported, setWebRTCSupported] = useState(true);
  const [mediaPermissionDenied, setMediaPermissionDenied] = useState(false);
  const [mediaPermissionGranted, setMediaPermissionGranted] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [isStartingCall, setIsStartingCall] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);

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

  const checkWebRTCAvailability = useCallback(() => {
    const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
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

  useEffect(() => {
    const initialize = async () => {
      console.log('[VideoCall] Initializing WebRTC checks');
      const isSupported = checkWebRTCAvailability();
      setWebRTCSupported(isSupported);

      if (!isSupported) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(track => track.stop());
        setMediaPermissionGranted(true);
      } catch (err) {
        console.error('[VideoCall] Media permission denied:', err);
        setMediaPermissionDenied(true);
      }
    };

    initialize();
  }, [checkWebRTCAvailability]);

  const initializeCall = useCallback(async () => {
    if (!webRTCSupported || !sessionData.partnerSocketId || !mediaPermissionGranted) return;

    console.log('[VideoCall] Starting call initialization attempt', retryCountRef.current);
    setIsStartingCall(true);
    setConnectionStatus('connecting');

    try {
      await startCall();
      console.log('[VideoCall] Call started successfully');
      retryCountRef.current = 0;
    } catch (error) {
      console.error('[VideoCall] Call initialization failed:', error);
      if (retryCountRef.current < 2) {
        retryCountRef.current += 1;
        console.log(`[VideoCall] Retrying call (attempt ${retryCountRef.current})`);
        setTimeout(initializeCall, 2000 * retryCountRef.current);
        return;
      }
      setConnectionStatus('disconnected');
      setCallError('Failed to establish connection. Please check your network and try again.');
    } finally {
      setIsStartingCall(false);
    }
  }, [webRTCSupported, sessionData.partnerSocketId, mediaPermissionGranted, startCall]);

  useEffect(() => {
    if (!sessionData.partnerSocketId) return;
    initializeCall();
    return () => {
      console.log('[VideoCall] Cleaning up call initialization');
      if (retryCountRef.current > 0) {
        clearTimeout(retryCountRef.current as unknown as number);
      }
    };
  }, [initializeCall, sessionData.partnerSocketId]);

  useEffect(() => {
    console.log('[VideoCall] Connection state update:', isConnected);
    setConnectionStatus(isConnected ? 'connected' : 'disconnected');
    if (!isConnected && connectionStatus === 'connected') {
      setCallError('Connection lost. Attempting to reconnect...');
      initializeCall();
    }
  }, [isConnected, connectionStatus, initializeCall]);

  useEffect(() => {
    if (connectionStatus === 'connected') {
      console.log('[VideoCall] Starting call timer');
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else if (callTimerRef.current) {
      console.log('[VideoCall] Pausing call timer');
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [connectionStatus]);

  useEffect(() => {
    if (localStream && localVideoRef.current && !localVideoRef.current.srcObject) {
      console.log('[VideoCall] Setting local video stream');
      localVideoRef.current.srcObject = localStream;
    }
    return () => {
      if (localVideoRef.current?.srcObject) {
        console.log('[VideoCall] Clearing local video stream');
        localVideoRef.current.srcObject = null;
      }
    };
  }, [localStream]);

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current && !remoteVideoRef.current.srcObject) {
      console.log('[VideoCall] Setting remote video stream');
      remoteVideoRef.current.srcObject = remoteStream;
    }
    return () => {
      if (remoteVideoRef.current?.srcObject) {
        console.log('[VideoCall] Clearing remote video stream');
        remoteVideoRef.current.srcObject = null;
      }
    };
  }, [remoteStream]);

  useEffect(() => {
    if (!socket) return;
    console.log('[VideoCall] Setting up socket listeners');
    const handleCallEnded = (data: { reason: string }) => {
      console.log('[VideoCall] Partner ended call:', data.reason);
      setCallError(`Call ended: ${data.reason || 'Partner disconnected'}`);
      setTimeout(onCallEnd, 2000);
    };
    const handleIceRestart = () => {
      console.log('[VideoCall] ICE restart requested');
      initializeCall();
    };
    socket.on('call-ended', handleCallEnded);
    socket.on('ice-restart', handleIceRestart);
    return () => {
      console.log('[VideoCall] Cleaning up socket listeners');
      socket.off('call-ended', handleCallEnded);
      socket.off('ice-restart', handleIceRestart);
    };
  }, [socket, onCallEnd, initializeCall]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = useCallback(async () => {
    console.log('[VideoCall] User initiated call end');
    try {
      await endCall();
      await fetch(`/api/session/${sessionData.sessionId}/end`, { method: 'POST' });
      if (socket) {
        socket.emit('end-call', { sessionId: sessionData.sessionId, partnerId: sessionData.partnerId });
      }
    } catch (error) {
      console.error('[VideoCall] Error ending call:', error);
    } finally {
      onCallEnd();
    }
  }, [endCall, sessionData, socket, onCallEnd]);

  const handleToggleMute = useCallback(() => {
    try {
      const newMutedState = toggleMute();
      setIsMuted(newMutedState);
    } catch (error) {
      console.error('[VideoCall] Failed to toggle audio:', error);
      setMediaPermissionDenied(true);
    }
  }, [toggleMute]);

  const handleToggleVideo = useCallback(() => {
    try {
      const newVideoState = toggleVideo();
      setIsVideoOff(!newVideoState);
    } catch (error) {
      console.error('[VideoCall] Failed to toggle video:', error);
      setMediaPermissionDenied(true);
    }
  }, [toggleVideo]);

  const handleReport = () => {
    console.log('[VideoCall] User reported partner');
    alert('Report submitted. Our team will review this call.');
  };

  const handleNextChat = async () => {
    console.log('[VideoCall] User requested next chat');
    await handleEndCall();
  };

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

        {/* Video Container */}
        <div className="flex-1 relative bg-gray-800 overflow-hidden">
          {/* Remote Video */}
          <div className="absolute inset-0 flex items-center justify-center">
            {connectionStatus !== 'connected' ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800/90">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 mx-auto mb-4 text-white animate-spin" />
                  <div className="text-white">
                    {isStartingCall ? 'Starting call...' : 'Connecting to partner...'}
                  </div>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
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
                <Loader2 className="w-6 h-6 text-white animate-spin" />
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
