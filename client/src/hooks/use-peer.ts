import { useEffect, useRef, useState } from "react";
import Peer, { MediaConnection } from "peerjs";

export function usePeerJS({ onRemoteStream, onOpen, onCallEnd }: {
  onRemoteStream: (stream: MediaStream) => void;
  onOpen: (peerId: string) => void;
  onCallEnd?: () => void;
}) {
  const [peer, setPeer] = useState<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);

  useEffect(() => {
    const p = new Peer(); // Uses public PeerJS server
    setPeer(p);

    p.on("open", (id) => {
      onOpen(id);
    });

    p.on("call", (call) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
        call.answer(stream);
        call.on("stream", (remoteStream) => {
          onRemoteStream(remoteStream);
        });
        callRef.current = call;
        call.on("close", () => {
          onCallEnd && onCallEnd();
        });
      });
    });

    return () => {
      p.destroy();
      callRef.current?.close();
    };
  }, []);

  const callPeer = (remotePeerId: string, localStream: MediaStream) => {
    if (!peer) return;
    const call = peer.call(remotePeerId, localStream);
    call.on("stream", (remoteStream) => {
      onRemoteStream(remoteStream);
    });
    callRef.current = call;
    call.on("close", () => {
      onCallEnd && onCallEnd();
    });
  };

  return { peer, callPeer };
}