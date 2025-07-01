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
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      console.warn("⚠️ WebRTC may not work properly without HTTPS");
    }
  }, []);

  // Initialize local camera and mic
  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });
      console.log("🎥 Media stream initialized");
      setLocalStream(stream);
      localStreamRef.current = stream;
      return stream;
    } catch (error) {
      console.error("❌ Error accessing media devices:", error);
      throw error;
    }
  }, []);

  // Setup signaling listeners
  useEffect(() => {
    if (!socket) {
      console.warn("⚠️ useWebRTC: Socket is null");
      return;
    }

    if (!targetSocketId) {
      console.warn("⚠️ useWebRTC: targetSocketId is undefined. WebRTC signaling will not work.");
      return;
    }

    console.log("📡 Setting up signaling listeners for socket:", socket.id, " -> target:", targetSocketId);

    const handleOffer = async (data: any) => {
      console.log("📩 Received offer from:", data.fromSocketId);
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error("❌ Peer connection not initialized while handling offer.");
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
        console.log("📤 Sent answer to:", data.fromSocketId);
      }
    };

    const handleAnswer = async (data: any) => {
      console.log("📩 Received answer from:", data.fromSocketId);
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error("❌ Peer connection not initialized while handling answer.");
        return;
      }

      if (data.fromSocketId === targetSocketId) {
        await pc.setRemoteDescription(data.answer);
        console.log("✅ Answer set as remote description");
      }
    };

    const handleIce = async (data: any) => {
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error("❌ Peer connection not initialized while handling ICE.");
        return;
      }

      if (data.fromSocketId === targetSocketId) {
        try {
          await pc.addIceCandidate(data.candidate);
          console.log("🧊 Added ICE candidate from:", data.fromSocketId);
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

  // Start the call
  const startCall = useCallback(async () => {
    if (!socket || !targetSocketId) {
      console.warn("⚠️ Cannot start call — socket or targetSocketId missing");
      return;
    }

    try {
      const stream = await initializeMedia();
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      // Add tracks
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Handle incoming stream
      pc.ontrack = (event) => {
        console.log("📥 Received remote stream");
        setRemoteStream(event.streams[0]);
      };

      // Handle ICE
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("webrtc-ice-candidate", {
            targetSocketId,
            candidate: event.candidate,
          });
          console.log("📤 Sent ICE candidate to:", targetSocketId);
        }
      };

      // Track connection state
      pc.onconnectionstatechange = () => {
        console.log("🔄 Connection state changed:", pc.connectionState);
        setIsConnected(pc.connectionState === "connected");
      };

      // Initiator sends offer
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("webrtc-offer", {
          targetSocketId,
          offer,
        });
        console.log("📤 Sent offer to:", targetSocketId);
      }
    } catch (error) {
      console.error("❌ Error during startCall:", error);
    }
  }, [socket, targetSocketId, isInitiator, initializeMedia]);

  // End the call and clean up
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
    console.log("📴 Call ended and cleaned up");
  }, []);

  // Toggle mic
  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled;
    }
    return false;
  }, []);

  // Toggle camera
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
