import React, { useEffect, useRef, useState } from "react";

interface LocalVideoTestProps {
  localVideoStream: MediaStream | null;
}

const LocalVideoTest: React.FC<LocalVideoTestProps> = ({ localVideoStream }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localVideoStream) {
      console.log("LocalVideoTest: attaching local video stream", localVideoStream);
      localVideoRef.current.srcObject = localVideoStream;

      if (playTimeoutRef.current) {
        clearTimeout(playTimeoutRef.current);
        playTimeoutRef.current = null;
      }

      playTimeoutRef.current = setTimeout(() => {
        localVideoRef.current?.play().then(() => {
          setIsPlaying(true);
        }).catch((error) => {
          console.error("Error playing local video stream:", error);
          setIsPlaying(false);
        });
      }, 10000);
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
