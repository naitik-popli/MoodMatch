import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { createPeerConnection } from "../lib/webrtc";

interface UseWebRTCProps {
  socket: Socket | null;
  isInitiator: boolean;
  targetUserId?: number;
  externalLocalStream?: MediaStream | null;
}

export function useWebRTC({ socket, isInitiator, targetUserId, externalLocalStream }: UseWebRTCProps) {
  // Stable logger that won't change between renders
  const log = useRef((...args: any[]) => console.log("[WEBRTC]", ...args)).current;

  // State management
  const [localStream, setLocalStream] = useState<MediaStream | null>(externalLocalStream || null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<string>("new");

  // Refs for stable references and instance management
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const isMountedRef = useRef(true);
  const socketRef = useRef<Socket | null>(null);
  const targetUserIdRef = useRef<number | undefined>();
  const isInitiatorRef = useRef(false);
  const operationLockRef = useRef(false);

  // Update refs when props change
  useEffect(() => {
    socketRef.current = socket;
    targetUserIdRef.current = targetUserId;
    isInitiatorRef.current = isInitiator;
  }, [socket, targetUserId, isInitiator]);

  // Initialize media stream
  const initializeMedia = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) return localStreamRef.current;

    try {
      const stream = externalLocalStream || await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: 1280, height: 720, facingMode: "user" }
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (error) {
      log("Media access error:", error);
      return null;
    }
  }, [externalLocalStream, log]);

  // Create and configure peer connection
  const setupPeerConnection = useCallback((): RTCPeerConnection => {
    if (peerConnectionRef.current && peerConnectionRef.current.connectionState !== 'closed') {
      return peerConnectionRef.current;
    }

    // Clean up previous connection if exists
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const pc = createPeerConnection();
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (!event.candidate || !socketRef.current || !targetUserIdRef.current) return;
      
      log("Sending ICE candidate");
      socketRef.current.emit("webrtc-ice-candidate", {
        targetUserId: targetUserIdRef.current,
        candidate: event.candidate
      });
    };

    pc.ontrack = (event) => {
      if (!event.streams || event.streams.length === 0) return;
      
      const [stream] = event.streams;
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      log("Received remote stream with tracks:", 
        stream.getTracks().map(t => `${t.kind}:${t.readyState}`));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnectionState(state);
      setIsConnected(state === "connected");
      log("Connection state changed:", state);
    };

    pc.oniceconnectionstatechange = () => {
      log("ICE connection state:", pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      log("Signaling state:", pc.signalingState);
    };

    return pc;
  }, [log]);

  // Start the call process
  const startCall = useCallback(async () => {
    if (operationLockRef.current) return;
    operationLockRef.current = true;

    try {
      const pc = setupPeerConnection();
      const stream = await initializeMedia();

      if (stream) {
        stream.getTracks().forEach(track => {
          if (!pc.getSenders().some(s => s.track === track)) {
            pc.addTrack(track, stream);
          }
        });
      }

      if (isInitiatorRef.current) {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        
        if (socketRef.current && targetUserIdRef.current) {
          socketRef.current.emit("webrtc-offer", {
            targetUserId: targetUserIdRef.current,
            offer
          });
        }
      }
    } catch (error) {
      log("Call setup error:", error);
    } finally {
      operationLockRef.current = false;
    }
  }, [initializeMedia, setupPeerConnection, log]);

  // Handle incoming WebRTC signals
  useEffect(() => {
    if (!socketRef.current) return;

    const handleOffer = async (data: { fromSocketId: string; offer: RTCSessionDescriptionInit }) => {
      if (!isMountedRef.current) return;

      try {
        const pc = setupPeerConnection();
        const stream = await initializeMedia();

        await pc.setRemoteDescription(data.offer);
        log("Set remote description with offer");

        if (stream) {
          stream.getTracks().forEach(track => {
            if (!pc.getSenders().some(s => s.track === track)) {
              pc.addTrack(track, stream);
            }
          });
        }

        // Process queued candidates
        for (const candidate of pendingCandidatesRef.current) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (e) {
            log("Error adding queued candidate:", e);
          }
        }
        pendingCandidatesRef.current = [];

        if (pc.signalingState === "have-remote-offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          if (socketRef.current && targetUserIdRef.current) {
            socketRef.current.emit("webrtc-answer", {
              targetUserId: targetUserIdRef.current,
              answer
            });
          }
        }
      } catch (error) {
        log("Offer handling error:", error);
      }
    };

    const handleAnswer = async (data: { answer: RTCSessionDescriptionInit }) => {
      if (!peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.setRemoteDescription(data.answer);
        log("Set remote description with answer");
      } catch (error) {
        log("Answer handling error:", error);
      }
    };

    const handleIceCandidate = async (data: { candidate: RTCIceCandidateInit }) => {
      if (!peerConnectionRef.current) {
        pendingCandidatesRef.current.push(data.candidate);
        return;
      }

      try {
        if (peerConnectionRef.current.remoteDescription) {
          await peerConnectionRef.current.addIceCandidate(data.candidate);
        } else {
          pendingCandidatesRef.current.push(data.candidate);
        }
      } catch (error) {
        log("ICE candidate error:", error);
      }
    };

    socketRef.current.on("webrtc-offer", handleOffer);
    socketRef.current.on("webrtc-answer", handleAnswer);
    socketRef.current.on("webrtc-ice-candidate", handleIceCandidate);

    return () => {
      if (!socketRef.current) return;
      socketRef.current.off("webrtc-offer", handleOffer);
      socketRef.current.off("webrtc-answer", handleAnswer);
      socketRef.current.off("webrtc-ice-candidate", handleIceCandidate);
    };
  }, [initializeMedia, setupPeerConnection, log]);

  // Auto-start call for initiator when ready
  useEffect(() => {
    if (isInitiatorRef.current && socketRef.current?.connected) {
      startCall();
    }
  }, [startCall]);

  // Cleanup function
  const endCall = useCallback(() => {
    if (!isMountedRef.current) return;

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }

    remoteStreamRef.current = null;
    setRemoteStream(null);
    setIsConnected(false);
    setConnectionState("closed");
    pendingCandidatesRef.current = [];
  }, []);

  // Component cleanup
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      endCall();
    };
  }, [endCall]);

  // Media control functions
  const toggleMute = useCallback((): boolean => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled;
    }
    return false;
  }, []);

  const toggleVideo = useCallback((): boolean => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return videoTrack.enabled;
    }
    return false;
  }, []);

  return {
    localStream,
    remoteStream,
    isConnected,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
    connectionState
  };
}