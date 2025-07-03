import React, { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "../components/ui/button";
import { 
  Mic, MicOff, Video, VideoOff, Phone, Settings, 
  Flag, Shuffle, Monitor, Loader2, AlertCircle
} from "lucide-react";
import { useWebRTC } from "../hooks/use-webrtc";
import { useSocket } from "../hooks/use-socket";
import type { Mood } from "@shared/schema";

// Enhanced debugging with timestamp
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
  const [callError, setCallError] = useState<string | null>(null);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false);

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

  // Enhanced WebRTC availability check
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

  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: true
      });
      return stream;
    } catch (error) {
      log('Media access error:', error);
      setMediaPermissionDenied(true);
      throw error;
    }
  }, [log]);

  // Enhanced media permission check
  useEffect(() => {
    const initialize = async () => {
      log('Initializing media checks');
      const isSupported = checkWebRTCAvailability();
      setWebRTCSupported(isSupported);

      if (!isSupported) {
        log('WebRTC not supported');
        return;
      }

      try {
        log('Checking existing permissions');
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasAudio = devices.some(d => d.kind === 'audioinput' && d.deviceId);
        const hasVideo = devices.some(d => d.kind === 'videoinput' && d.deviceId);
        
        log('Existing devices:', { hasAudio, hasVideo, devices });
        
        if (hasAudio && hasVideo) {
          log('Permissions already granted');
          setMediaPermissionGranted(true);
          return;
        }

        log('Requesting media permissions');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        
        log('Media stream obtained', {
          videoTracks: stream.getVideoTracks().map(t => t.label),
          audioTracks: stream.getAudioTracks().map(t => t.label),
          streamActive: stream.active
        });
        
        // Store debug info
        setStreamDebug({
          video: stream.getVideoTracks()[0]?.getSettings(),
          audio: stream.getAudioTracks()[0]?.getSettings()
        });
        
        // Immediately stop tracks - we just needed permission
        stream.getTracks().forEach(track => {
          log(`Stopping track: ${track.kind}`, track);
          track.stop();
        });
        
        setMediaPermissionGranted(true);
      } catch (err) {
        log('Media permission error:', err);
        setMediaPermissionDenied(true);
        setCallError('Could not access camera/microphone. Please check permissions.');
      }
    };

    initialize();
  }, [checkWebRTCAvailability, log]);

  // Enhanced call initialization
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

   const attachStream = useCallback((stream: MediaStream | null, isLocal: boolean) => {
    const videoEl = isLocal ? localVideoRef.current : remoteVideoRef.current;
    if (!videoEl || !stream) return;

    videoEl.srcObject = stream;
    videoEl.playsInline = true;
    videoEl.muted = isLocal;

    videoEl.play().catch(err => {
      log(`${isLocal ? 'Local' : 'Remote'} video play failed:`, err);
      if (isLocal) setNeedsUserInteraction(true);
    });

    // Debugging handlers
    videoEl.onloadedmetadata = () => {
      log(`${isLocal ? 'Local' : 'Remote'} video metadata loaded`, {
        width: videoEl.videoWidth,
        height: videoEl.videoHeight
      });
    };

    videoEl.onplaying = () => {
      log(`${isLocal ? 'Local' : 'Remote'} video playing`);
      setNeedsUserInteraction(false);
    };
  }, [log]);

   useEffect(() => {
    attachStream(localStream, true);
  }, [localStream, attachStream]);

  useEffect(() => {
    attachStream(remoteStream, false);
  }, [remoteStream, attachStream]);

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

  // Enhanced stream attachment effects
  useEffect(() => {
    log('Local stream changed', {
      stream: localStream,
      tracks: localStream?.getTracks().map(t => ({
        kind: t.kind,
        readyState: t.readyState,
        enabled: t.enabled,
        muted: t.muted
      }))
    });

    if (localVideoRef.current && localStream) {
      log('Attaching local stream to video element');
      localVideoRef.current.srcObject = localStream;
      
      // Debugging for video element
      const checkVideoPlayback = () => {
        log('Video element state', {
          readyState: localVideoRef.current?.readyState,
          videoWidth: localVideoRef.current?.videoWidth,
          videoHeight: localVideoRef.current?.videoHeight,
          paused: localVideoRef.current?.paused,
          error: localVideoRef.current?.error
        });
      };
      
      localVideoRef.current.onloadedmetadata = checkVideoPlayback;
      localVideoRef.current.onplaying = checkVideoPlayback;
      localVideoRef.current.onerror = (e) => {
        log('Video element error:', e);
      };
    }

    return () => {
      if (localVideoRef.current?.srcObject) {
        log('Cleaning up local video ref');
        localVideoRef.current.srcObject = null;
      }
    };
  }, [localStream, log]);

  useEffect(() => {
    log('Remote stream changed', {
      stream: remoteStream,
      tracks: remoteStream?.getTracks().map(t => ({
        kind: t.kind,
        readyState: t.readyState,
        enabled: t.enabled,
        muted: t.muted
      }))
    });

    if (remoteVideoRef.current && remoteStream) {
      log('Attaching remote stream to video element');
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, log]);

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
         <div className="absolute top-4 left-4 bg-black/70 text-white p-2 text-xs z-50 rounded">
        <div>Local Stream: {localStream?.id || 'None'}</div>
        <div>Remote Stream: {remoteStream?.id || 'None'}</div>
        <div>Connection: {connectionStatus}</div>
        <div>Call Duration: {formatDuration(callDuration)}</div>
        {streamDebug && (
          <pre>{JSON.stringify(streamDebug, null, 2)}</pre>
        )}
      </div>
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
