import React, { useEffect, useRef } from "react";

interface LocalVideoTestProps {
  localVideoStream: MediaStream | null;
}

const LocalVideoTest: React.FC<LocalVideoTestProps> = ({ localVideoStream }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localVideoStream) {
      console.log("LocalVideoTest: attaching local video stream", localVideoStream);
      localVideoRef.current.srcObject = localVideoStream;
      localVideoRef.current.play().catch((error) => {
        console.error("Error playing local video stream:", error);
      });
    }
  }, [localVideoStream]);

  return (
    <video
      ref={localVideoRef}
      autoPlay
      muted
      playsInline
      style={{ width: "320px", height: "240px", backgroundColor: "black" }}
    />
  );
};

export default LocalVideoTest;
