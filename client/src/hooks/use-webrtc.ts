import { useCallback, useEffect, useRef, useState } from "react";
import SimplePeer, { Instance } from "simple-peer";
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

  const peerRef = useRef<Instance | null>(null);
  const ws = useWebSocket();

  // Get user media
  useEffect(() => {
    if (externalLocalStream) {
      setLocalStream(externalLocalStream);
      console.log("[WebRTC] Using external local stream");
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        setLocalStream(stream);
        console.log("[WebRTC] Got user media", stream);
      })
      .catch(err => {
        alert("Could not access camera/mic: " + err.message);
        console.error("[WebRTC] Media error:", err);
      });
  }, [externalLocalStream]);

  // Setup signaling and peer
  useEffect(() => {
    if (!localStream) {
      console.log("[WebRTC] Waiting for local stream...");
      return;
    }
    if (!ws) {
      console.log("[WebRTC] Waiting for WebSocket...");
      return;
    }

    console.log("[WebRTC] Setting up SimplePeer and signaling...", { isInitiator, localStream, ws });

    // WebSocket event listeners
    const handleOpen = () => {
      console.log("[WS] Connected to signaling server");
    };
    const handleError = (err: Event) => {
      console.error("[WS] WebSocket error:", err);
    };
    const handleClose = (event: CloseEvent) => {
      console.warn("[WS] WebSocket closed:", event);
      setIsConnected(false);
    };
    const handleMessage = async (message: MessageEvent) => {
      let data: any;
      if (typeof message.data === "string") {
        data = JSON.parse(message.data);
      } else if (message.data instanceof Blob) {
        const text = await message.data.text();
        data = JSON.parse(text);
      } else {
        return;
      }
      console.log("[WS] Received:", data);

      // Only handle signaling messages here
      if (data.type === "signal" && data.data) {
        if (peerRef.current) {
          try {
            console.log("[WebRTC] Passing signal to peerRef.current", peerRef.current, data.data);
            peerRef.current.signal(data.data);
            console.log("[WebRTC] Received signal, passed to peer:", data.data);
          } catch (err) {
            console.error("[WebRTC] Error signaling peer:", err, peerRef.current, data.data);
          }
        } else {
          console.warn("[WebRTC] Peer not ready to receive signal", data.data);
        }
      }
    };

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("error", handleError);
    ws.addEventListener("close", handleClose);
    ws.addEventListener("message", handleMessage);

    // Create SimplePeer
    const peer = new SimplePeer({
      initiator: isInitiator,
      trickle: true,
      stream: localStream,
    });
    peerRef.current = peer;
    console.log("[WebRTC] Creating SimplePeer instance", { isInitiator, localStream, peer });

    // Defensive check: delay signaling until peer is ready
    let isPeerReady = false;
    peer.on("ready", () => {
      isPeerReady = true;
      console.log("[Peer] Peer is ready");
    });

    // Extra logging for peerRef.current
    if (!peerRef.current) {
      console.warn("[WebRTC] peerRef.current is undefined after peer creation!");
    } else {
      console.log("[WebRTC] peerRef.current is defined after peer creation", peerRef.current);
    }

    peer.on("signal", data => {
      if (!isPeerReady) {
        console.warn("[Peer] Signal emitted before peer ready, delaying send", data);
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            console.log("[Peer] Delayed sending signal:", data);
            ws.send(JSON.stringify({
              type: "signal",
              data,
              ...(partnerId ? { to: partnerId } : {}),
              ...(userId ? { from: userId } : {}),
            }));
          } else {
            console.warn("[Peer] WebSocket not open during delayed signal send");
          }
        }, 100);
        return;
      }
      console.log("[Peer] Sending signal:", data, { wsReady: ws.readyState === WebSocket.OPEN });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "signal",
          data,
          ...(partnerId ? { to: partnerId } : {}),
          ...(userId ? { from: userId } : {}),
        }));
      } else {
        console.warn("[Peer] Tried to send signal but WS is not open");
      }
    });

    peer.on("stream", stream => {
      console.log("[Peer] Received remote stream", stream);
      setRemoteStream(stream);
    });

    peer.on("connect", () => {
      setIsConnected(true);
      console.log("[Peer] Connected!");
    });

    peer.on("close", () => {
      setIsConnected(false);
      setRemoteStream(null);
      console.log("[Peer] Connection closed");
    });

    peer.on("error", err => {
      console.error("[Peer] Error:", err, peerRef.current);
    });

    return () => {
      console.log("[WebRTC] Cleaning up peer and WebSocket listeners", peerRef.current);
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("close", handleClose);
      ws.removeEventListener("message", handleMessage);
    };
  }, [localStream, ws, isInitiator, partnerId, userId]);

  // End call
  const endCall = useCallback(() => {
    console.log("[WebRTC] Ending call", peerRef.current);
    if (peerRef.current) {
      peerRef.current.destroy();
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
      console.log("[WebRTC] Toggled mute:", !audioTrack.enabled);
      return !audioTrack.enabled;
    }
    return false;
  }, [localStream]);

  // Enable/disable video
  const toggleVideo = useCallback(() => {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      console.log("[WebRTC] Toggled video:", videoTrack.enabled);
      return videoTrack.enabled;
    }
    return false;
  }, [localStream]);

  // Cleanup on unmount
  useEffect(() => endCall, [endCall]);

  return {
    localStream,
    remoteStream,
    isConnected,
    endCall,
    toggleMute,
    toggleVideo,
  };
}