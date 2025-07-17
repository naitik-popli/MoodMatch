import { useCallback, useEffect, useRef, useState } from "react";
import SimplePeer, { Instance, SignalData } from "simple-peer";

interface UseWebRTCSimpleProps {
  wsUrl: string; // e.g. wss://moodmatch-1.onrender.com
  isInitiator: boolean;
  externalLocalStream?: MediaStream | null;
}

export function useWebRTC({ wsUrl, isInitiator, externalLocalStream }: UseWebRTCSimpleProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(externalLocalStream || null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const peerRef = useRef<Instance | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Get user media
  useEffect(() => {
    if (externalLocalStream) {
      setLocalStream(externalLocalStream);
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        setLocalStream(stream);
      })
      .catch(err => {
        alert("Could not access camera/mic: " + err.message);
      });
  }, [externalLocalStream]);

  // Setup signaling and peer
  useEffect(() => {
    if (!localStream) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] Connected to signaling server");
    };

    ws.onmessage = async (message) => {
      let signal: SignalData;
      if (typeof message.data === "string") {
        signal = JSON.parse(message.data);
      } else if (message.data instanceof Blob) {
        const text = await message.data.text();
        signal = JSON.parse(text);
      } else {
        return;
      }
      console.log("[WS] Received signal:", signal);
      peerRef.current?.signal(signal);
    };

    // Create SimplePeer
    const peer = new SimplePeer({
      initiator: isInitiator,
      trickle: true,
      stream: localStream,
    });
    peerRef.current = peer;

    peer.on("signal", data => {
      console.log("[Peer] Sending signal:", data);
      ws.send(JSON.stringify(data));
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
      peer.destroy();
      ws.close();
    };
  }, [localStream, wsUrl, isInitiator]);

  // End call
  const endCall = useCallback(() => {
    peerRef.current?.destroy();
    wsRef.current?.close();
    setRemoteStream(null);
    setIsConnected(false);
  }, []);

  // Mute/unmute audio
  const toggleMute = useCallback(() => {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled;
    }
    return false;
  }, [localStream]);

  // Enable/disable video
  const toggleVideo = useCallback(() => {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
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