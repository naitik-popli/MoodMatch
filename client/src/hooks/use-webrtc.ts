import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { createPeerConnection } from "../lib/webrtc";

interface UseWebRTCProps {
  socket: Socket | null;
  isInitiator: boolean;
  targetSocketId?: string;
}

export function useWebRTC({ socket, isInitiator, targetSocketId }: UseWebRTCProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Warn if not using HTTPS
  useEffect(() => {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      console.warn('⚠️ WebRTC may not work properly without HTTPS');
    }
  }, []);

  // Initialize camera/mic
  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });

      setLocalStream(stream);
      localStreamRef.current = stream;
      return stream;
    } catch (error) {
      console.error("❌ Error accessing media devices:", error);
      throw error;
    }
  }, []);

  // Set up signaling listeners once
  useEffect(() => {
    if (!socket || !targetSocketId) return;

    const handleOffer = async (data: any) => {
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error("Received webrtc-offer but peer connection is not initialized.");
        return;
      }
      if (data.fromSocketId === targetSocketId) {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc-answer", {
          targetSocketId: data.fromSocketId,
          answer,
        });
      }
    };

    const handleAnswer = async (data: any) => {
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error("Received webrtc-answer but peer connection is not initialized.");
        return;
      }
      if (data.fromSocketId === targetSocketId) {
        await pc.setRemoteDescription(data.answer);
      }
    };

    const handleIce = async (data: any) => {
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error("Received webrtc-ice-candidate but peer connection is not initialized.");
        return;
      }
      if (data.fromSocketId === targetSocketId) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          console.error("❌ Error adding ICE candidate:", err);
        }
      }
    };

    socket.on("webrtc-offer", handleOffer);
    socket.on("webrtc-answer", handleAnswer);
    socket.on("webrtc-ice-candidate", handleIce);

    return () => {
      socket.off("webrtc-offer", handleOffer);
      socket.off("webrtc-answer", handleAnswer);
      socket.off("webrtc-ice-candidate", handleIce);
    };
  }, [socket, targetSocketId]);

  // Start call
  const startCall = useCallback(async () => {
    if (!socket || !targetSocketId) return;

    try {
      const stream = await initializeMedia();
      const pc = createPeerConnection(); // should include STUN
      peerConnectionRef.current = pc;

      // Add tracks to peer connection
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Handle remote stream
      pc.ontrack = (event) => {
        console.log("📥 Received remote stream");
        setRemoteStream(event.streams[0]);
      };

      // ICE candidate sending
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("webrtc-ice-candidate", {
            targetSocketId,
            candidate: event.candidate,
          });
        }
      };

      // Connection state updates
      pc.onconnectionstatechange = () => {
        console.log("🔄 Connection state:", pc.connectionState);
        setIsConnected(pc.connectionState === "connected");
      };

      // Initiator logic
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("webrtc-offer", {
          targetSocketId,
          offer,
        });
      }
    } catch (error) {
      console.error("❌ Error during startCall:", error);
    }
  }, [socket, targetSocketId, isInitiator, initializeMedia]);

  // End call
  const endCall = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null);
    setIsConnected(false);
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled;
    }
    return false;
  }, []);

  // Toggle video
  const toggleVideo = useCallback(() => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return videoTrack.enabled;
    }
    return false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      endCall();
    };
  }, [endCall]);

  return {
    localStream,
    remoteStream,
    isConnected,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
}
