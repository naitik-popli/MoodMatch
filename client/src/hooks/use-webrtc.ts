import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { createPeerConnection } from "../lib/webrtc";

// Debugging utility
const debug = (context: string) => (...args: any[]) => {
  console.log(`[WEBRTC:${context}]`, ...args);
};

interface UseWebRTCProps {
  socket: Socket | null;
  isInitiator: boolean;
  targetSocketId?: string;
}

export function useWebRTC({ socket, isInitiator, targetSocketId }: UseWebRTCProps) {
  const log = debug('useWebRTC');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('new');

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // Enhanced media initialization
  const initializeMedia = useCallback(async () => {
    log('Initializing media devices');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      log('Obtained media stream', {
        id: stream.id,
        active: stream.active,
        videoTracks: stream.getVideoTracks().map(t => ({
          id: t.id,
          readyState: t.readyState,
          settings: t.getSettings()
        })),
        audioTracks: stream.getAudioTracks().map(t => ({
          id: t.id,
          readyState: t.readyState
        }))
      });

      setLocalStream(stream);
      localStreamRef.current = stream;
      return stream;
    } catch (error) {
      log('Media access error:', error);
      throw error;
    }
  }, [log]);

  // Enhanced peer connection management
  const setupPeerConnection = useCallback(() => {
    log('Creating new peer connection');
    const pc = createPeerConnection();
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socket && targetSocketId) {
        log('Sending ICE candidate', event.candidate);
        socket.emit("webrtc-ice-candidate", {
          targetSocketId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      log('Received remote track', event.track);
      if (event.streams && event.streams[0]) {
        const newStream = event.streams[0];
        remoteStreamRef.current = newStream;
        setRemoteStream(newStream);
        log('Set remote stream', {
          id: newStream.id,
          tracks: newStream.getTracks().map(t => t.id)
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnectionState(state);
      log('Connection state changed:', state);
      setIsConnected(state === "connected");
    };

    pc.oniceconnectionstatechange = () => {
      log('ICE connection state:', pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      log('Signaling state:', pc.signalingState);
    };

    return pc;
  }, [socket, targetSocketId, log]);

  // Enhanced signaling handlers
  useEffect(() => {
    if (!socket) {
      log('Socket not available');
      return;
    }

    const handleOffer = async (data: any) => {
      log('Received offer from:', data.fromSocketId);
      if (data.fromSocketId !== targetSocketId) return;

      try {
        const pc = peerConnectionRef.current || setupPeerConnection();
        await pc.setRemoteDescription(data.offer);
        log('Set remote description');

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        log('Created and set local answer');

        socket.emit("webrtc-answer", {
          targetSocketId: data.fromSocketId,
          answer,
        });
      } catch (error) {
        log('Error handling offer:', error);
      }
    };

    const handleAnswer = async (data: any) => {
      log('Received answer from:', data.fromSocketId);
      if (data.fromSocketId !== targetSocketId || !peerConnectionRef.current) return;

      try {
        await peerConnectionRef.current.setRemoteDescription(data.answer);
        log('Successfully set remote answer');
      } catch (error) {
        log('Error handling answer:', error);
      }
    };

    const handleIce = async (data: any) => {
      if (data.fromSocketId !== targetSocketId || !peerConnectionRef.current) return;
      
      try {
        await peerConnectionRef.current.addIceCandidate(data.candidate);
        log('Added ICE candidate');
      } catch (error) {
        log('Error adding ICE candidate:', error);
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
  }, [socket, targetSocketId, setupPeerConnection, log]);

  // Enhanced call start
  const startCall = useCallback(async () => {
    if (!socket || !targetSocketId) {
      log('Cannot start call - missing socket or target ID');
      return;
    }

    try {
      const stream = await initializeMedia();
      const pc = setupPeerConnection();

      // Add tracks with better error handling
      stream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, stream);
          log(`Added ${track.kind} track to peer connection`);
        } catch (error) {
          log(`Error adding ${track.kind} track:`, error);
        }
      });

      if (isInitiator) {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        log('Created and set local offer');

        socket.emit("webrtc-offer", {
          targetSocketId,
          offer,
        });
      }
    } catch (error) {
      log('Error during call start:', error);
      throw error;
    }
  }, [socket, targetSocketId, isInitiator, initializeMedia, setupPeerConnection, log]);

  // Enhanced call end with cleanup
  const endCall = useCallback(() => {
    log('Ending call and cleaning up');
    
    if (peerConnectionRef.current) {
      log('Closing peer connection');
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      log('Stopping local stream tracks');
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        log(`Stopped ${track.kind} track`);
      });
      localStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      log('Clearing remote stream');
      remoteStreamRef.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null);
    setIsConnected(false);
    setConnectionState('closed');
  }, [log]);

  // Enhanced media control
  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      const newState = !audioTrack.enabled;
      audioTrack.enabled = newState;
      log(`Audio track ${newState ? 'unmuted' : 'muted'}`);
      return !newState;
    }
    log('No audio track to toggle');
    return false;
  }, [log]);

  const toggleVideo = useCallback(() => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      const newState = !videoTrack.enabled;
      videoTrack.enabled = newState;
      log(`Video track ${newState ? 'enabled' : 'disabled'}`);
      return newState;
    }
    log('No video track to toggle');
    return false;
  }, [log]);

  // Debug effect to log state changes
  useEffect(() => {
    log('State update', {
      localStream: localStream?.id,
      remoteStream: remoteStream?.id,
      isConnected,
      connectionState
    });
  }, [localStream, remoteStream, isConnected, connectionState, log]);

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
    connectionState // Expose for debugging
  };
}
</create_file>
