import React, { useEffect, useRef, useState } from "react";

export default function LocalVideoTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function startLocalVideo() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        setError("Failed to access local video: " + (err instanceof Error ? err.message : String(err)));
      }
    }
    startLocalVideo();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

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
