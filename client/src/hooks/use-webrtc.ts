import { useCallback, useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import { useWebSocket } from "../context/WebSocketContext";

interface UseWebRTCProps {
  isInitiator: boolean;
  externalLocalStream?: MediaStream | null;
  partnerId?: number;
  userId?: number;
}

export function useWebRTC({ isInitiator, externalLocalStream, partnerId, userId }: UseWebRTCProps) {
  // State management
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iceConnectionState, setIceConnectionState] = useState<string>("new");
  const [signalingState, setSignalingState] = useState<string>("stable");

  // Refs for instance management
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const { ws } = useWebSocket();
  const mediaRequestedRef = useRef(false);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountId = useRef(Math.random().toString(36).substring(2, 8));

  // Detailed logging function with instance ID
  const log = useCallback((stage: string, message: string, data?: any) => {
    console.log(`[WebRTC:${mountId.current}] ${stage.padEnd(15)} ${message}`, data ?? '');
  }, []);

  // 1. Media Stream Acquisition ===============================================
  useEffect(() => {
    log("MEDIA", "Starting media acquisition");
    if (mediaRequestedRef.current) {
      log("MEDIA", "Media already requested, skipping");
      return;
    }
    mediaRequestedRef.current = true;

    const getMedia = async () => {
      try {
        if (externalLocalStream) {
          log("MEDIA", "Using external local stream", {
            tracks: externalLocalStream.getTracks().map(t => t.kind)
          });
          setLocalStream(externalLocalStream);
          return;
        }

        log("MEDIA", "Requesting user media permissions");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        log("MEDIA", "Obtained user media stream", {
          audio: stream.getAudioTracks().length > 0,
          video: stream.getVideoTracks().length > 0
        });
        setLocalStream(stream);
      } catch (err) {
        const errorMsg = "Could not access camera/microphone";
        log("MEDIA", "Error acquiring media", { error: err, message: errorMsg });
        setError(errorMsg);
      }
    };

    getMedia();

    return () => {
      if (!externalLocalStream && localStream) {
        log("MEDIA", "Cleaning up local stream", {
          tracks: localStream.getTracks().map(t => `${t.kind}:${t.id}`)
        });
        localStream.getTracks().forEach(track => {
          track.stop();
          log("MEDIA", "Stopped track", { kind: track.kind, id: track.id });
        });
      }
    };
  }, [externalLocalStream, log, localStream]);

  // 2. WebRTC Peer Connection Management =====================================
  useEffect(() => {
    if (!ws || !localStream) {
      log("PEER", "Waiting for WebSocket or local stream", {
        wsReady: !!ws,
        streamReady: !!localStream
      });
      return;
    }

    log("PEER", "Initializing new peer connection", {
      isInitiator,
      partnerId,
      userId
    });

    const setupPeer = () => {
      try {
        const peer = new SimplePeer({
          initiator: isInitiator,
          trickle: true,
          stream: localStream,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { 
                urls: 'turn:your-turn-server.com:3478',
                username: 'your-username',
                credential: 'your-credential' 
              }
            ]
          }
        });
        peerRef.current = peer;

        // ICE Connection State Tracking
        peer.on('iceConnectionStateChange', () => {
          const state = peer.iceConnectionState;
          setIceConnectionState(state);
          log("ICE", `State changed: ${state}`);
          
          if (state === 'failed') {
            log("ICE", "ICE failure detected, attempting restart");
            restartConnection();
          }
        });

        // Signaling State Tracking
        peer.on('signalingStateChange', () => {
          const state = peer.signalingState;
          setSignalingState(state);
          log("SIGNAL", `State changed: ${state}`);
        });

        // Connection Events
        peer.on('connect', () => {
          log("PEER", "Connection established");
          setIsConnected(true);
          setError(null);
        });

        peer.on('close', () => {
          log("PEER", "Connection closed");
          setIsConnected(false);
          setRemoteStream(null);
        });

        peer.on('error', (err) => {
          log("PEER", "Connection error", err);
          setError("WebRTC connection error");
          restartConnection();
        });

        // Signaling Data Handling
        peer.on('signal', (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            const signalData = {
              type: "signal",
              data,
              ...(partnerId && { to: partnerId }),
              ...(userId && { from: userId })
            };
            log("SIGNAL", "Sending signaling data", { type: data.type });
            ws.send(JSON.stringify(signalData));
          } else {
            log("SIGNAL", "WebSocket not ready for signaling", {
              wsState: ws.readyState
            });
          }
        });

        // Remote Stream Handling
        peer.on('stream', (stream) => {
          log("STREAM", "Received remote stream", {
            tracks: stream.getTracks().map(t => t.kind)
          });
          setRemoteStream(stream);
        });

        // Track Events for Detailed Debugging
        peer.on('track', (track, stream) => {
          log("TRACK", `Remote ${track.kind} track added`, {
            trackId: track.id,
            streamId: stream.id
          });
        });

      } catch (err) {
        log("PEER", "Initialization error", err);
        setError("Failed to initialize WebRTC connection");
        restartConnection();
      }
    };

    const handleMessage = async (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' 
          ? JSON.parse(event.data) 
          : JSON.parse(await event.data.text());
        
        if (data.type === "signal" && peerRef.current) {
          log("SIGNAL", "Received signaling data", { type: data.data.type });
          peerRef.current.signal(data.data);
        }
      } catch (err) {
        log("SIGNAL", "Error processing message", { error: err, data: event.data });
      }
    };

    const restartConnection = () => {
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }

      log("RECOVERY", "Scheduling connection restart", { delay: 2000 });
      restartTimeoutRef.current = setTimeout(() => {
        log("RECOVERY", "Attempting connection restart");
        cleanup();
        setupPeer();
      }, 2000);
    };

    const cleanup = () => {
      log("CLEANUP", "Performing cleanup");
      if (peerRef.current) {
        log("CLEANUP", "Destroying peer instance");
        peerRef.current.destroy();
        peerRef.current = null;
      }
      ws.removeEventListener('message', handleMessage);
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
    };

    // Setup new connection
    setupPeer();
    ws.addEventListener('message', handleMessage);

    return () => {
      log("CLEANUP", "Component unmount cleanup");
      cleanup();
    };
  }, [ws, localStream, isInitiator, partnerId, userId, log]);

  // 3. Media Control Functions ===============================================
  const toggleMute = useCallback((): boolean => {
    if (!localStream) {
      log("CONTROL", "Cannot toggle mute - no local stream");
      return false;
    }
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const newState = !audioTrack.enabled;
      audioTrack.enabled = newState;
      log("CONTROL", `Audio ${newState ? "unmuted" : "muted"}`);
      return !newState;
    }
    
    log("CONTROL", "No audio track to toggle");
    return false;
  }, [localStream, log]);

  const toggleVideo = useCallback((): boolean => {
    if (!localStream) {
      log("CONTROL", "Cannot toggle video - no local stream");
      return false;
    }
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const newState = !videoTrack.enabled;
      videoTrack.enabled = newState;
      log("CONTROL", `Video ${newState ? "enabled" : "disabled"}`);
      return newState;
    }
    
    log("CONTROL", "No video track to toggle");
    return false;
  }, [localStream, log]);

  const endCall = useCallback(() => {
    log("CONTROL", "Ending call explicitly");
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsConnected(false);
    setRemoteStream(null);
    setError(null);
  }, [log]);

  return {
    localStream,
    remoteStream,
    isConnected,
    error,
    iceConnectionState,
    signalingState,
    endCall,
    toggleMute,
    toggleVideo
  };
}

// Video Component Implementation =============================================
// interface VideoProps {
//   stream: MediaStream | null;
//   muted?: boolean;
//   className?: string;
//   onPlayError?: (error: Error) => void;
// }

// export function Video({ stream, muted = false, className, onPlayError }: VideoProps) {
//   const videoRef = useRef<HTMLVideoElement>(null);
//   const playAttemptRef = useRef(0);

//   useEffect(() => {
//     const video = videoRef.current;
//     if (!video || !stream) return;

//     const handlePlay = () => {
//       if (playAttemptRef.current > 3) {
//         log("VIDEO", "Max play attempts reached, giving up");
//         return;
//       }

//       video.play()
//         .then(() => {
//           log("VIDEO", "Playback started successfully");
//         })
//         .catch(err => {
//           playAttemptRef.current++;
//           log("VIDEO", `Play attempt ${playAttemptRef.current} failed`, err);
          
//           if (onPlayError) {
//             onPlayError(err);
//           }

//           // Implement click-to-play fallback
//           if (playAttemptRef.current === 1) {
//             const handleClick = () => {
//               video.play()
//                 .then(() => {
//                   log("VIDEO", "Playback started after user interaction");
//                   document.removeEventListener('click', handleClick);
//                 })
//                 .catch(err => {
//                   log("VIDEO", "Playback failed after user interaction", err);
//                 });
//             };
            
//             document.addEventListener('click', handleClick);
//             log("VIDEO", "Waiting for user interaction to start playback");
//           }
//         });
//     };

//     const handleLoadedMetadata = () => {
//       log("VIDEO", "Stream metadata loaded, attempting play");
//       handlePlay();
//     };

//     log("VIDEO", "Setting video source");
//     video.srcObject = stream;
//     video.addEventListener('loadedmetadata', handleLoadedMetadata);

//     return () => {
//       log("VIDEO", "Cleaning up video element");
//       video.removeEventListener('loadedmetadata', handleLoadedMetadata);
//       video.srcObject = null;
//       playAttemptRef.current = 0;
//     };
//   }, [stream, onPlayError]);

//   return (
//     <video
//       ref={videoRef}
//       muted={muted}
//       autoPlay
//       playsInline
//       className={className}
//     />
//   );
// }

// Helper function for component logging
function log(context: string, message: string, data?: any) {
  console.log(`[VideoComponent] ${context.padEnd(10)} ${message}`, data ?? '');
}