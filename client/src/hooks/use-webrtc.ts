import { useCallback, useEffect, useRef, useState } from "react";
import SimplePeer, { Instance } from "simple-peer";
import { useWebSocket } from "../context/WebSocketContext";

interface UseWebRTCSimpleProps {
  isInitiator: boolean;
  externalLocalStream?: MediaStream | null;
  partnerId?: number; // Add this if you want to signal to a specific partner
  userId?: number;    // Add this if you want to include your own id in signaling
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
        console.log("[WebRTC] Got user media");
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

    console.log("[WebRTC] Setting up SimplePeer and signaling...");

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
            peerRef.current.signal(data.data);
            console.log("[WebRTC] Received signal, passed to peer:", data.data);
          } catch (err) {
            console.error("[WebRTC] Error signaling peer:", err);
          }
        } else {
          console.warn("[WebRTC] Peer not ready to receive signal");
        }
      }
      // Handle other message types elsewhere in your app
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

    // Defensive check: delay signaling until peer is ready
    let isPeerReady = false;
    peer.on("ready", () => {
      isPeerReady = true;
      console.log("[Peer] Peer is ready");
    });

    peer.on("signal", data => {
      if (!isPeerReady) {
        console.warn("[Peer] Signal emitted before peer ready, delaying send");
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "signal",
              data,
              ...(partnerId ? { to: partnerId } : {}),
              ...(userId ? { from: userId } : {}),
            }));
          }
        }, 100);
        return;
      }
      console.log("[Peer] Sending signal:", data);
      if (ws.readyState === WebSocket.OPEN) {
        // If you need to send to a specific partner, include 'to' and 'from'
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
      console.log("[Peer] Received remote stream");
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
      console.error("[Peer] Error:", err);
    });

    return () => {
      console.log("[WebRTC] Cleaning up peer and WebSocket listeners");
      peer.destroy();
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("close", handleClose);
      ws.removeEventListener("message", handleMessage);
      // Do NOT close ws here! It's shared via context.
    };
  }, [localStream, ws, isInitiator, partnerId, userId]);

  // End call
  const endCall = useCallback(() => {
    console.log("[WebRTC] Ending call");
    peerRef.current?.destroy();
    setRemoteStream(null);
    setIsConnected(false);
    // Do NOT close ws here!
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