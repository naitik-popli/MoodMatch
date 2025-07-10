import React, { useEffect, useRef, useState } from "react";

export default function LocalStreamPreview({ setLocalStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

 
  useEffect(() => {
    let stream: MediaStream | null = null;
    async function getLocalStream() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setError("Could not access camera/mic: " + (err instanceof Error ? err.message : String(err)));
      }
    }
    getLocalStream();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [setLocalStream]);

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }


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
