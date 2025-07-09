import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { createPeerConnection } from "../lib/webrtc";

interface UseWebRTCProps {
  socket: Socket | null;
  isInitiator: boolean;
  targetUserId?: number;
}

export function useWebRTC({ socket, isInitiator, targetUserId }: UseWebRTCProps) {
  // Debug utility
  const log = (...args: any[]) => console.log("[WEBRTC]", ...args);

  // State and refs
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<string>("new");
  const [socketIdReady, setSocketIdReady] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const startCallCalledRef = useRef(false);
  const mediaInitializedRef = useRef(false);

  // Only create one peer connection per call
  const setupPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      log("Peer connection already exists, reusing it.");
      return peerConnectionRef.current;
    }
    log("Creating new peer connection");
    const pc = createPeerConnection();
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socket && targetUserId) {
        log("Sending ICE candidate", event.candidate);
        socket.emit("webrtc-ice-candidate", { targetUserId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      log("ontrack fired", event);
      if (event.streams && event.streams[0]) {
        const newStream = event.streams[0];
        log("Received remote stream", newStream);
        if (remoteStreamRef.current !== newStream) {
          remoteStreamRef.current = newStream;
          setRemoteStream(newStream);
          log("Remote stream set", newStream);
        }
      } else {
        log("ontrack fired but no streams found", event);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnectionState(state);
      setIsConnected(state === "connected");
    };

    pc.oniceconnectionstatechange = () => {
      log("ICE connection state:", pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      log("Signaling state:", pc.signalingState);
    };

    return pc;
  }, [socket, targetUserId, log]);

  // Initialize media devices
  const initializeMedia = useCallback(async () => {
    if (mediaInitializedRef.current) {
      log("Media already initialized, skipping...");
      return localStreamRef.current;
    }
    mediaInitializedRef.current = true;
    try {
      const constraints = {
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      localStreamRef.current = stream;
      log("Local media stream initialized", stream);
      return stream;
    } catch (error) {
      log("Media access error:", error);
      throw error;
    }
  }, [log]);

  // Track socket id readiness
  useEffect(() => {
    setSocketIdReady(!!(socket && socket.id));
  }, [socket, socket?.id]);

  // Track media readiness
  useEffect(() => {
    setMediaReady(!!(localStream && localStream.active));
  }, [localStream]);

  // Start call (initiator)
  const startCall = useCallback(async () => {
    if (!socket || !targetUserId) {
      log("Cannot start call — socket or targetUserId missing");
      return;
    }
    try {
      const stream = await initializeMedia();
      const pc = setupPeerConnection();
      stream?.getTracks().forEach(track => {
        if (!pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, stream);
          log("Added local track (initiator)", track);
        }
      });
      if (isInitiator) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        log("Created and set local description with offer");
        socket.emit("webrtc-offer", { targetUserId, offer });
        log("Sent offer to", targetUserId);
      }
    } catch (error) {
      log("Error during call start:", error);
    }
  }, [socket, targetUserId, isInitiator, initializeMedia, setupPeerConnection, log]);

  // Auto-start call when ready
  useEffect(() => {
    if (mediaReady && socketIdReady && !startCallCalledRef.current) {
      startCallCalledRef.current = true;
      startCall().catch(err => {
        log("Error starting call:", err);
        startCallCalledRef.current = false;
      });
    }
  }, [mediaReady, socketIdReady, startCall, log]);

  // Signaling handlers
  useEffect(() => {
    if (!socket || socket.disconnected || !targetUserId) return;

    const handleOffer = async (data: any) => {
      log("Received offer", data);
      if (data.fromSocketId !== targetUserId) return;
      try {
        const pc = setupPeerConnection();
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            if (!pc.getSenders().some(sender => sender.track === track)) {
              pc.addTrack(track, localStreamRef.current!);
              log("Added local track (receiver)", track);
            }
          });
        }
        await pc.setRemoteDescription(data.offer);
        log("Set remote description with offer");
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        log("Created and set local description with answer");
        socket.emit("webrtc-answer", { targetUserId: data.fromSocketId, answer });
        log("Sent answer to", data.fromSocketId);
      } catch (error) {
        log("Error handling offer:", error);
      }
    };

    const handleAnswer = async (data: any) => {
      log("Received answer", data);
      if (data.fromSocketId !== targetUserId || !peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.setRemoteDescription(data.answer);
        log("Set remote description with answer");
      } catch (error) {
        log("Error handling answer:", error);
      }
    };

    const handleIce = async (data: any) => {
      log("Received ICE candidate", data);
      if (data.fromSocketId !== targetUserId || !peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.addIceCandidate(data.candidate);
        log("Added ICE candidate");
      } catch (error) {
        log("Error adding ICE candidate:", error);
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
  }, [socket, targetUserId, setupPeerConnection, log]);

  // End call and cleanup
  const endCall = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setIsConnected(false);
    setConnectionState("closed");
  }, []);

  // Mute/unmute audio
  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled;
    }
    return false;
  }, []);

  // Enable/disable video
  const toggleVideo = useCallback(() => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return videoTrack.enabled;
    }
    return false;
  }, []);

  // Assign remote stream to video element
  useEffect(() => {
    if (remoteStream) {
      const remoteVideoElement = document.getElementById("remoteVideo") as HTMLVideoElement | null;
      if (remoteVideoElement) {
        remoteVideoElement.srcObject = remoteStream;
      }
    }
  }, [remoteStream]);

  // Cleanup on unmount
  useEffect(() => endCall, [endCall]);

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