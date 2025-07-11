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
  const log = (...args: any[]) => console.log("[WEBRTC]", ...args);

  const [localStream, setLocalStream] = useState<MediaStream | null>(externalLocalStream || null);
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

  const peerSocketIdRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<any[]>([]);

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
      log("onicecandidate event", event);
     if (event.candidate && socket) {
  log("[useWebRTC] ICE candidate emission targetUserId:", targetUserId, typeof targetUserId);
  if (typeof targetUserId !== "number") {
    log("[useWebRTC] Invalid targetUserId for ICE emission:", targetUserId, typeof targetUserId);
    return;
  }
  log("Sending ICE candidate", event.candidate);
  socket.emit("webrtc-ice-candidate", { targetUserId, candidate: event.candidate });
}
    };

    pc.ontrack = (event) => {
      log("[WEBRTC] ontrack fired", event);
      if (event.streams && event.streams[0]) {
        const newStream = event.streams[0];
        log("[WEBRTC] Received remote stream", newStream);
        log("[WEBRTC] Remote stream tracks:", newStream.getTracks().map(t => `${t.kind}:${t.readyState}`));
        remoteStreamRef.current = newStream;
        setRemoteStream(newStream);
        log("[WEBRTC] Remote stream set", newStream);
      } else {
        log("[WEBRTC] ontrack fired but no streams found", event);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log("Connection state changed:", state);
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
  }, [socket, targetUserId, log]
);

  // Initialize media devices
  const initializeMedia = useCallback(async () => {
    log("Initializing media...");
    if (mediaInitializedRef.current) {
      log("Media already initialized, skipping...");
      return localStreamRef.current;
    }
    mediaInitializedRef.current = true;
    if (externalLocalStream) {
      log("Using external local stream", externalLocalStream);
      setLocalStream(externalLocalStream);
      localStreamRef.current = externalLocalStream;
      return externalLocalStream;
    }
    try {
      const constraints = {
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
      };
      log("Requesting user media with constraints", constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      log("Local media stream initialized", stream);
      setLocalStream(stream);
      localStreamRef.current = stream;
      return stream;
    } catch (error) {
      log("Media access error:", error);
      throw error;
    }
  }, [externalLocalStream, log]);

  // Track socket id readiness
  useEffect(() => {
    log("Socket ID ready?", !!(socket && socket.id));
    setSocketIdReady(!!(socket && socket.id));
  }, [socket, socket?.id]);

  // Track media readiness
  useEffect(() => {
    log("Media ready?", !!(localStream && localStream.active));
    setMediaReady(!!(localStream && localStream.active));
  }, [localStream]);

  // Start call (initiator)
  const startCall = useCallback(async () => {
    log("Attempting to start call...");
    if (!socket || !targetUserId) {
      log("Cannot start call — socket or targetUserId missing");
      return;
    }
    
    if (peerConnectionRef.current) {
      log("Closing previous peer connection before starting new call");
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    try {
      const stream = await initializeMedia();
      log("Got local stream for call", stream);
      const pc = setupPeerConnection();
      stream?.getTracks().forEach(track => {
        if (!pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, stream);
          log("Added local track (initiator)", track);
        }
      });
      if (isInitiator) {
        log("Creating offer...");
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        log("Created and set local description with offer");
       log("[useWebRTC] Offer emission targetUserId:", targetUserId, typeof targetUserId);
if (typeof targetUserId !== "number") {
  log("[useWebRTC] Invalid targetUserId for offer emission:", targetUserId, typeof targetUserId);
  return;
}
socket.emit("webrtc-offer", { targetUserId, offer });
log("Sent offer to", targetUserId);
      }
    } catch (error) {
      log("Error during call start:", error);
    }
  }, [socket, targetUserId, isInitiator, initializeMedia, setupPeerConnection, log]);

  // Auto-start call when ready
  useEffect(() => {
    log("Auto-start call check", { mediaReady, socketIdReady, isInitiator, alreadyStarted: startCallCalledRef.current });
    if (mediaReady && socketIdReady && isInitiator && !startCallCalledRef.current) {
      log("Auto-starting call...");
      startCallCalledRef.current = true;
      startCall().catch(err => {
        log("Error starting call:", err);
        startCallCalledRef.current = false;
      });
    }
  }, [mediaReady, socketIdReady, startCall, log, isInitiator]);

  // Signaling handlers
  useEffect(() => {
    log("Setting up signaling handlers");
    if (!socket || socket.disconnected || !targetUserId) {
      log("Socket not ready for signaling handlers");
      return;
    }

    const offerHandledRef = { current: false };

    const handleOffer = async (data: any) => {
      log("Received offer", data);
      if (offerHandledRef.current) {
        log("Offer already handled, skipping.");
        return;
      }
      offerHandledRef.current = true;
      peerSocketIdRef.current = data.fromSocketId;

      // Wait for local media stream to be ready
      let retries = 0;
      while (!localStreamRef.current && retries < 20) {
        log("Waiting for local media stream to be ready...");
        await new Promise(res => setTimeout(res, 100));
        retries++;
      }
      if (!localStreamRef.current) {
        log("Error: Local media stream is still not available after waiting.");
        return;
      }

      try {
        const pc = setupPeerConnection();
        let stream = localStreamRef.current;

        // 1. Set remote description first!
        await pc.setRemoteDescription(data.offer);
        log("Set remote description with offer");

        // 2. Add local tracks
        if (stream) {
          stream.getTracks().forEach(track => {
            if (!pc.getSenders().some(sender => sender.track === track)) {
              pc.addTrack(track, stream);
              log("Added local track (receiver)", track);
            }
          });
        }

        // 3. Add any queued ICE candidates
        for (const candidate of pendingCandidatesRef.current) {
          try {
            await pc.addIceCandidate(candidate);
            log("Added queued ICE candidate");
          } catch (err) {
            log("Error adding queued ICE candidate", err);
          }
        }
        pendingCandidatesRef.current = [];

        // 4. Create and set answer
        if (pc.signalingState === "have-remote-offer") {
          log("Creating answer...");
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          log("Created and set local description with answer");
         log("[useWebRTC] Answer emission targetUserId:", data.fromSocketId, typeof data.fromSocketId);
log("[useWebRTC] Answer emission targetUserId:", targetUserId, typeof targetUserId);
if (typeof targetUserId !== "number") {
  log("[useWebRTC] Invalid targetUserId for answer emission:", targetUserId, typeof targetUserId);
  return;
}
socket.emit("webrtc-answer", { targetUserId, answer });
log("Sent answer to", targetUserId);
        } else {
          log("Not creating answer, signaling state:", pc.signalingState);
        }
      } catch (error) {
        log("Error handling offer:", error);
      }
    };

    const handleAnswer = async (data: any) => {
      log("Received answer", data);
      peerSocketIdRef.current = data.fromSocketId;
      if (!peerConnectionRef.current) {
        log("No peer connection to set answer on");
        return;
      }
      try {
        await peerConnectionRef.current.setRemoteDescription(data.answer);
        log("Set remote description with answer");
      } catch (error) {
        log("Error handling answer:", error);
      }
    };

    const handleIce = async (data: any) => {
      log("Received ICE candidate", data);
      if (!peerConnectionRef.current) {
        log("No peer connection to add ICE candidate to");
        return;
      }
      if (peerConnectionRef.current.remoteDescription && peerConnectionRef.current.remoteDescription.type) {
        try {
          await peerConnectionRef.current.addIceCandidate(data.candidate);
          log("Added ICE candidate");
        } catch (error) {
          log("Error adding ICE candidate:", error);
        }
      } else {
        // Queue ICE candidates until remote description is set
        pendingCandidatesRef.current.push(data.candidate);
        log("Queued ICE candidate");
      }
    };

    socket.on("webrtc-offer", handleOffer);
    socket.on("webrtc-answer", handleAnswer);
    socket.on("webrtc-ice-candidate", handleIce);

    return () => {
      log("Cleaning up signaling handlers");
      socket.off("webrtc-offer", handleOffer);
      socket.off("webrtc-answer", handleAnswer);
      socket.off("webrtc-ice-candidate", handleIce);
    };
  }, [socket, targetUserId, setupPeerConnection, log, initializeMedia]);

  // End call and cleanup
  const endCall = useCallback(() => {
    log("Ending call and cleaning up");
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
      log("Peer connection closed");
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        log("Stopping local track", track);
        track.stop();
      });
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      log("Clearing remote stream ref");
      remoteStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setIsConnected(false);
    setConnectionState("closed");
    mediaInitializedRef.current = false;
    startCallCalledRef.current = false;
  }, []);

  // Mute/unmute audio
  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      log("Toggled mute, now enabled:", audioTrack.enabled);
      return !audioTrack.enabled;
    }
    log("No audio track to mute/unmute");
    return false;
  }, []);

  // Enable/disable video
  const toggleVideo = useCallback(() => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      log("Toggled video, now enabled:", videoTrack.enabled);
      return videoTrack.enabled;
    }
    log("No video track to enable/disable");
    return false;
  }, []);

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