import { useCallback, useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import { useWebSocket } from "../context/WebSocketContext";

interface UseWebRTCSimpleProps {
  isInitiator: boolean;
  externalLocalStream?: MediaStream | null;
  partnerId?: number;
  userId?: number;
}

export function useWebRTC({ isInitiator, externalLocalStream, partnerId, userId }: UseWebRTCSimpleProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(externalLocalStream || null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [ready, setReady] = useState(false);

  const peerRef = useRef<any>(null);
  const { ws } = useWebSocket();

  // Get user media
  useEffect(() => {
    console.log("[WebRTC] [STEP 1] Checking for externalLocalStream...");
    if (externalLocalStream) {
      setLocalStream(externalLocalStream);
      console.log("[WebRTC] [STEP 1] Using external local stream", externalLocalStream);
      return;
    }
    console.log("[WebRTC] [STEP 1] Requesting user media...");
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        setLocalStream(stream);
        console.log("[WebRTC] [STEP 1] Got user media", stream);
      })
      .catch(err => {
        alert("Could not access camera/mic: " + err.message);
        console.error("[WebRTC] [STEP 1] Media error:", err);
      });
  }, [externalLocalStream]);

  // Set ready flag when both localStream and ws are available and valid
  useEffect(() => {
    if (localStream && ws && typeof ws.addEventListener === "function") {
      setReady(true);
      console.log("[WebRTC] [DEFENSE] Ready to create peer: localStream and ws are set");
    } else {
      setReady(false);
      if (!localStream) console.log("[WebRTC] [DEFENSE] Not ready: localStream missing");
      if (!ws) console.log("[WebRTC] [DEFENSE] Not ready: ws missing");
      if (ws && typeof ws.addEventListener !== "function") {
        console.warn("[WebRTC] [DEFENSE] ws exists but is not a valid WebSocket instance");
      }
    }
  }, [localStream, ws]);

  // Setup signaling and peer
  useEffect(() => {
    if (!ready) {
      console.log("[WebRTC] [DEFENSE] Not ready for peer creation");
      return;
    }
    if (
      !ws ||
      typeof ws.addEventListener !== "function" ||
      typeof ws.removeEventListener !== "function"
    ) {
      console.error("[WebRTC] [DEFENSE] ws is not a valid WebSocket instance, aborting peer setup.", ws);
      return;
    }
    console.log("[WebRTC] [STEP 2] Setup signaling and peer", { localStream, ws, isInitiator, partnerId, userId });

    // Defensive: Destroy any previous peer before creating a new one
    if (peerRef.current) {
      console.warn("[WebRTC] [STEP 2] Destroying previous peer before creating new one", peerRef.current);
      try {
        peerRef.current.destroy();
      } catch (err) {
        console.error("[WebRTC] [DEFENSE] Error destroying previous peer", err);
      }
      peerRef.current = null;
    }

    let peer: any = null;

    if (localStream && typeof window !== "undefined") {
      try {
        peer = new SimplePeer({
          initiator: isInitiator,
          trickle: true,
          stream: localStream || undefined,
        });
        peerRef.current = peer;

        // ---- Add WebRTC connection state logs ----
        peer.on("signal", () => {
          if ((peer as any)._pc) {
            const pc = (peer as any)._pc as RTCPeerConnection;
            pc.addEventListener("iceconnectionstatechange", () => {
              console.log("[WebRTC] [RTC] ICE connection state:", pc.iceConnectionState);
            });
            pc.addEventListener("connectionstatechange", () => {
              console.log("[WebRTC] [RTC] Connection state:", pc.connectionState);
            });
            pc.addEventListener("signalingstatechange", () => {
              console.log("[WebRTC] [RTC] Signaling state:", pc.signalingState);
            });
          }
        });

        peer.on("connect", () => {
          setIsConnected(true);
          console.log("[WebRTC] [STEP 5] Peer connect event");
          if ((peer as any)._pc) {
            console.log("[WebRTC] [RTC] Connection state:", (peer as any)._pc.connectionState);
          }
        });

        peer.on("close", () => {
          setIsConnected(false);
          setRemoteStream(null);
          console.log("[WebRTC] [STEP 7] Peer close event");
          if ((peer as any)._pc) {
            console.log("[WebRTC] [RTC] Connection state on close:", (peer as any)._pc.connectionState);
          }
        });

      } catch (err) {
        console.error("[WebRTC] [DEFENSE] Error creating SimplePeer", err);
        peerRef.current = null;
        return;
      }
    } else {
      console.warn("[WebRTC] [STEP 3] Not creating SimplePeer: localStream missing or not in browser");
      peerRef.current = null;
      return;
    }

    // Log peerRef after creation
    if (!peerRef.current) {
      console.warn("[WebRTC] [STEP 3] peerRef.current is undefined after peer creation!");
    } else {
      console.log("[WebRTC] [STEP 3] peerRef.current is defined after peer creation", peerRef.current);
    }

    // Peer event logging
    peer.on("signal", (data: any) => {
      console.log("[WebRTC] [STEP 4] Peer emitted signal event", data);
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: "signal",
            data,
            ...(partnerId ? { to: partnerId } : {}),
            ...(userId ? { from: userId } : {}),
          }));
          console.log("[WebRTC] [STEP 4] Sent signal via ws");
        } catch (err) {
          console.error("[WebRTC] [DEFENSE] Error sending signal via ws", err);
        }
      } else {
        console.warn("[WebRTC] [STEP 4] Tried to send signal but ws not open");
      }
    });

    peer.on("stream", (stream: MediaStream) => {
      setRemoteStream(stream);
      console.log("[WebRTC] [STEP 6] Peer received remote stream", stream);
    });

    peer.on("error", (err: any) => {
      console.error("[WebRTC] [STEP 8] Peer error event", err, peerRef.current);
    });

    // WebSocket event listeners
    const handleOpen = () => {
      console.log("[WebRTC] [STEP 9] WS Connected to signaling server");
    };
    const handleError = (err: Event) => {
      console.error("[WebRTC] [STEP 10] WS error:", err);
    };
    const handleClose = (event: CloseEvent) => {
      console.warn("[WebRTC] [STEP 11] WS closed:", event);
      setIsConnected(false);
    };
    const handleMessage = async (message: MessageEvent) => {
      let data: any;
      try {
        if (typeof message.data === "string") {
          data = JSON.parse(message.data);
        } else if (message.data instanceof Blob) {
          const text = await message.data.text();
          data = JSON.parse(text);
        } else {
          return;
        }
      } catch (err) {
        console.error("[WebRTC] [DEFENSE] Error parsing WS message", err, message.data);
        return;
      }
      console.log("[WebRTC] [STEP 12] WS Received:", data);

      // Only handle signaling messages here
      if (data.type === "signal" && data.data) {
        if (peerRef.current) {
          try {
            console.log("[WebRTC] [STEP 13] Passing signal to peerRef.current", peerRef.current, data.data);
            peerRef.current.signal(data.data);
            console.log("[WebRTC] [STEP 13] Received signal, passed to peer:", data.data);
          } catch (err) {
            console.error("[WebRTC] [STEP 13] Error signaling peer:", err, peerRef.current, data.data);
          }
        } else {
          console.warn("[WebRTC] [STEP 13] Peer not ready to receive signal", data.data);
        }
      }
    };

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("error", handleError);
    ws.addEventListener("close", handleClose);
    ws.addEventListener("message", handleMessage);

    return () => {
      console.log("[WebRTC] [STEP 14] Cleaning up peer and WebSocket listeners", peerRef.current);
      if (peerRef.current) {
        try {
          peerRef.current.destroy();
        } catch (err) {
          console.error("[WebRTC] [DEFENSE] Error destroying peer in cleanup", err);
        }
        peerRef.current = null;
      }
      if (ws && typeof ws.removeEventListener === "function") {
        ws.removeEventListener("open", handleOpen);
        ws.removeEventListener("error", handleError);
        ws.removeEventListener("close", handleClose);
        ws.removeEventListener("message", handleMessage);
      }
    };
  }, [ready, isInitiator, partnerId, userId, ws]);

  // End call
  const endCall = useCallback(() => {
    console.log("[WebRTC] [STEP 15] Ending call", peerRef.current);
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch (err) {
        console.error("[WebRTC] [DEFENSE] Error destroying peer in endCall", err);
      }
      peerRef.current = null;
    }
    setRemoteStream(null);
    setIsConnected(false);
  }, []);

  // Mute/unmute audio
  const toggleMute = useCallback(() => {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      console.log("[WebRTC] [STEP 16] Toggled mute:", !audioTrack.enabled);
      return !audioTrack.enabled;
    }
    console.log("[WebRTC] [STEP 16] No audio track to mute/unmute");
    return false;
  }, [localStream]);

  // Enable/disable video
  const toggleVideo = useCallback(() => {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      console.log("[WebRTC] [STEP 17] Toggled video:", videoTrack.enabled);
      return videoTrack.enabled;
    }
    console.log("[WebRTC] [STEP 17] No video track to enable/disable");
    return false;
  }, [localStream]);

  // Cleanup on unmount
  useEffect(() => {
    console.log("[WebRTC] [STEP 18] Cleanup on unmount");
    return endCall;
  }, [endCall]);

  return {
    localStream,
    remoteStream,
    isConnected,
    endCall,
    toggleMute,
    toggleVideo,
  };
}