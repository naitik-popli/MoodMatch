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

      // Add event listeners for tracks to detect ended or muted state
      stream.getTracks().forEach(track => {
        track.onended = () => {
          log(`Track ended: ${track.kind}`);
          // Optionally handle track ended (e.g., notify user)
        };
        track.onmute = () => {
          log(`Track muted: ${track.kind}`);
          // Optionally handle track muted
        };
        track.onunmute = () => {
          log(`Track unmuted: ${track.kind}`);
          // Optionally handle track unmuted
        };
      });

      // Add event listener for stream inactive to log and handle
      if ('oninactive' in stream) {
        stream.oninactive = () => {
          log('Media stream became inactive');
        };
      }

      // Add event listener for track ended to detect if video track ended and log
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          log('Video track ended');
          // Optionally handle video track ended (e.g., notify user, cleanup)
        };
      }

      return stream;
    } catch (error) {
      log('Media access error:', error);
      throw error;
    }
  }, [log]);

  // Ref to track if media has been initialized
  // This prevents multiple calls to getUserMedia
  // which can lead to permission issues or redundant streams
  // This is a common pattern to ensure media is only initialized once
  // and can be reused across multiple calls
  const mediaInitializedRef = useRef(false);

const initMedia = async () => {
  if (mediaInitializedRef.current) {
    console.warn("🎥 Media already initialized, skipping...");
    return;
  }
  mediaInitializedRef.current = true;

  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  setLocalStream(stream);
};


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

        // Send test message along with ICE candidate for debugging
        socket.emit("test-message", {
          message: "ICE candidate sent from client",
          candidate: event.candidate,
          timestamp: new Date().toISOString(),
          targetSocketId, // add targetSocketId for debugging
        });
      }
    };

    pc.ontrack = (event) => {
      log('Received remote track', event.track);
      if (event.streams && event.streams[0]) {
        const newStream = event.streams[0];
        if (remoteStreamRef.current !== newStream) {
          remoteStreamRef.current = newStream;
          setRemoteStream(newStream);
          log('Set remote stream', {
            id: newStream.id,
            tracks: newStream.getTracks().map(t => t.id)
          });
        }
      }
    };

    // Add local tracks immediately after creating peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try {
          // Check if track already added to avoid InvalidAccessError
          const senderExists = pc.getSenders().some(sender => sender.track === track);
          if (!senderExists) {
            pc.addTrack(track, localStreamRef.current!);
            log(`Added ${track.kind} track to peer connection on setup`);
          } else {
            log(`Skipped adding ${track.kind} track on setup - already added`);
          }
        } catch (e) {
          log(`Error adding ${track.kind} track on setup:`, e);
        }
      });
    }

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

  useEffect(() => {
    if (socket) {
      console.log("🧠 Local socket ID:", socket.id);
    }
  }, [socket]);

  // Track socket id readiness for signaling setup
  const [socketIdReady, setSocketIdReady] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);

  useEffect(() => {
    if (socket && socket.id) {
      setSocketIdReady(true);
      console.log("🧠 Socket ID ready for signaling:", socket.id);
    } else {
      setSocketIdReady(false);
    }
  }, [socket, socket?.id]);

  // Track media readiness for signaling setup
  useEffect(() => {
    if (localStream) {
      setMediaReady(true);
      console.log("🎥 Media stream ready for signaling:", localStream.id);
    } else {
      setMediaReady(false);
    }
  }, [localStream]);

  // Modify signaling setup effect to wait for socketIdReady and mediaReady
  useEffect(() => {
    if (!socket || !socketIdReady || !mediaReady) {
      log("Socket or media not ready, postponing signaling setup");
      return;
    }

    if (!targetSocketId) {
      console.warn("[WEBRTC:useWebRTC] Target socket ID is undefined");
      return;
    }

    let disconnectTimeout: NodeJS.Timeout | null = null;
    let callEnded = false;

    const handleOffer = async (data: any) => {
      log('Received offer from:', data.fromSocketId);
      if (data.fromSocketId !== targetSocketId) return;

      try {
        const pc = peerConnectionRef.current || setupPeerConnection();

        // Add local tracks if not already added
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            try {
              pc.addTrack(track, localStreamRef.current!);
              log(`Added ${track.kind} track to peer connection on offer`);
            } catch (e) {
              log(`Error adding ${track.kind} track on offer:`, e);
            }
          });
        }

        log('Setting remote description for offer');
        await pc.setRemoteDescription(data.offer);
        log('Set remote description for offer');

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        log('Created and set local answer');

        socket.emit("webrtc-answer", {
          targetSocketId: data.fromSocketId,
          answer,
        });
        log('Sent webrtc-answer');
      } catch (error) {
        log('Error handling offer:', error);
      }
    };

    const handleAnswer = async (data: any) => {
      log('Received answer from:', data.fromSocketId);
      if (data.fromSocketId !== targetSocketId || !peerConnectionRef.current) return;

      try {
        const pc = peerConnectionRef.current;

        // Add local tracks if not already added
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            try {
              pc.addTrack(track, localStreamRef.current!);
              log(`Added ${track.kind} track to peer connection on answer`);
            } catch (e) {
              log(`Error adding ${track.kind} track on answer:`, e);
            }
          });
        }

        log('Setting remote description for answer');
        await pc.setRemoteDescription(data.answer);
        log('Successfully set remote answer for answer');
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

    // Add listener for test-message event to log test messages
    const handleTestMessage = (data: any) => {
      log('Received test message:', data);
    };
    socket.on("test-message", handleTestMessage);

    // Add debug log for socket connection state
    socket.on("connect", () => {
      log('Socket connected:', socket.id);
    });
    socket.on("disconnect", (reason) => {
      log('Socket disconnected:', reason);
    });

    const handleDisconnect = () => {
      log('Socket disconnected, delaying call cleanup');
      if (!callEnded) {
        disconnectTimeout = setTimeout(() => {
          log("🔴 endCall() triggered — TRACE HANDLEDISCONNECT", new Error().stack);
          endCall();
          callEnded = true;
        }, 10000); // increased delay to 10 seconds
      }
    };

    const handleConnect = () => {
      log('Socket connected, clearing disconnect timeout');
      if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
      }
      callEnded = false;
    };

    socket.on("webrtc-offer", handleOffer);
    socket.on("webrtc-answer", handleAnswer);
    socket.on("webrtc-ice-candidate", handleIce);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect", handleConnect);

    return () => {
      socket.off("webrtc-offer", handleOffer);
      socket.off("webrtc-answer", handleAnswer);
      socket.off("webrtc-ice-candidate", handleIce);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect", handleConnect);
    };
  }, [socket, socketIdReady, targetSocketId, setupPeerConnection, log]);

  // Enhanced signaling handlers
  useEffect(() => {
  if (!socket || socket.disconnected) {
  log("Socket not ready, postponing signaling setup");
  return;
}


  if (!targetSocketId) {
    console.warn("[WEBRTC:useWebRTC] Target socket ID is undefined");
    return;
  }

  let disconnectTimeout: NodeJS.Timeout | null = null;
  let callEnded = false;

    const handleOffer = async (data: any) => {
      log('Received offer from:', data.fromSocketId);
      if (data.fromSocketId !== targetSocketId) return;

      try {
        const pc = peerConnectionRef.current || setupPeerConnection();

        // Add local tracks if not already added
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            try {
              pc.addTrack(track, localStreamRef.current!);
              log(`Added ${track.kind} track to peer connection on offer`);
            } catch (e) {
              log(`Error adding ${track.kind} track on offer:`, e);
            }
          });
        }

        log('Setting remote description for offer');
        await pc.setRemoteDescription(data.offer);
        log('Set remote description for offer');

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        log('Created and set local answer');

        socket.emit("webrtc-answer", {
          targetSocketId: data.fromSocketId,
          answer,
        });
        log('Sent webrtc-answer');
      } catch (error) {
        log('Error handling offer:', error);
      }
    };

    const handleAnswer = async (data: any) => {
      log('Received answer from:', data.fromSocketId);
      if (data.fromSocketId !== targetSocketId || !peerConnectionRef.current) return;

      try {
        const pc = peerConnectionRef.current;

        // Add local tracks if not already added
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            try {
              pc.addTrack(track, localStreamRef.current!);
              log(`Added ${track.kind} track to peer connection on answer`);
            } catch (e) {
              log(`Error adding ${track.kind} track on answer:`, e);
            }
          });
        }

        log('Setting remote description for answer');
        await pc.setRemoteDescription(data.answer);
        log('Successfully set remote answer for answer');
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

    const handleDisconnect = () => {
      log('Socket disconnected, delaying call cleanup');
      if (!callEnded) {
        disconnectTimeout = setTimeout(() => {
          log("🔴 endCall() triggered — TRACE HANDLEDISCONNECT", new Error().stack);
          endCall();
          callEnded = true;
        }, 10000); // increased delay to 10 seconds
      }
    };

    const handleConnect = () => {
      log('Socket connected, clearing disconnect timeout');
      if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
      }
      callEnded = false;
    };

    socket.on("webrtc-offer", handleOffer);
    socket.on("webrtc-answer", handleAnswer);
    socket.on("webrtc-ice-candidate", handleIce);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect", handleConnect);

    return () => {
      socket.off("webrtc-offer", handleOffer);
      socket.off("webrtc-answer", handleAnswer);
      socket.off("webrtc-ice-candidate", handleIce);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect", handleConnect);
    };
  }, [socket, targetSocketId, setupPeerConnection, log]);

  // Enhanced call start
  const startCall = useCallback(async () => {
    if (!socket || !targetSocketId) {
  console.warn("[WEBRTC:useWebRTC] Cannot start call — socket or targetSocketId missing");
  return;
}

    try {
      const stream = await initializeMedia();
      const pc = setupPeerConnection();

      // Add tracks with better error handling
      stream.getTracks().forEach((track) => {
        try {
          // Check if track already added to avoid InvalidAccessError
          const senderExists = pc.getSenders().some(sender => sender.track === track);
          if (!senderExists) {
            pc.addTrack(track, stream);
            log(`Added ${track.kind} track to peer connection`);
          } else {
            log(`Skipped adding ${track.kind} track - already added`);
          }
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
      
      // Temporarily disable connection state change handler to stop retry logic
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        log('Connection state changed:', state);
        setConnectionState(state);
        setIsConnected(state === "connected");
        // Do not call endCall on failure to stop retry logic temporarily
      };

    } catch (error) {
      log('Error during call start:', error);
      throw error;
    }
  }, [socket, targetSocketId, isInitiator, initializeMedia, setupPeerConnection, log]);

  // Enhanced call end with cleanup
  const endCall = useCallback(() => {
    if ((endCall as any).called) {
      log('endCall already called, skipping');
      return;
    }
    (endCall as any).called = true;

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

    if (remoteStream) {
      console.log('Assigning remoteStream to video element');
      const remoteVideoElement = document.getElementById('remoteVideo') as HTMLVideoElement | null;
      if (remoteVideoElement) {
        remoteVideoElement.srcObject = remoteStream;
        console.log('Remote video srcObject set');
      } else {
        console.warn('Remote video element not found');
      }
    } else {
      console.log('No remoteStream available to assign');
    }
  }, [localStream, remoteStream, isConnected, connectionState, log]);
  

  // Cleanup on unmount
  // useEffect(() => {
  //   return () => {
  //     log("🔴 endCall() triggered — TRACE Useeffect", new Error().stack);

  //     endCall();
  //   };
  // }, [endCall]);

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
