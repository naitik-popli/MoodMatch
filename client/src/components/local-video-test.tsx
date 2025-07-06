import React, { useEffect, useRef } from "react";
import { useLocalMediaStream } from "../hooks/useLocalMediaStream";

export default function LocalVideoTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { localStream, error } = useLocalMediaStream();

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
      videoRef.current.play().catch(() => {
        // Ignore play errors
      });
    }
  }, [localStream]);

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", backgroundColor: "#000" }}>
      {error ? (
        <div style={{ color: "red" }}>{error}</div>
      ) : (
        <video
          ref={videoRef}
          style={{ width: "640px", height: "480px", backgroundColor: "#000" }}
          autoPlay
          playsInline
          muted
        />
      )}
    </div>
  );
}
