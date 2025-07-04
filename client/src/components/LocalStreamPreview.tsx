import React, { useEffect, useRef, useState } from "react";

export default function LocalStreamPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function getLocalStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((e) => {
            console.warn("Auto-play prevented:", e);
          });
        }
      } catch (err) {
        setError("Failed to access camera and microphone. Please allow permissions.");
        console.error("Error accessing media devices:", err);
      }
    }

    getLocalStream();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Local Stream Preview</h2>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full max-w-md rounded-lg border border-gray-300"
      />
    </div>
  );
}
