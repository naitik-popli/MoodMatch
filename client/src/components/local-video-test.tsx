import React, { useEffect, useRef, useState } from "react";

interface LocalVideoTestProps {
  localVideoStream: MediaStream | null;
}

const LocalVideoTest: React.FC<LocalVideoTestProps> = ({ localVideoStream }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastStreamIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localVideoStream) {
      if (lastStreamIdRef.current === localVideoStream.id) {
        console.log("LocalVideoTest: same stream id, skipping re-attach", localVideoStream.id);
        return;
      }
      lastStreamIdRef.current = localVideoStream.id;

      console.log("LocalVideoTest: attaching local video stream", localVideoStream);
      localVideoRef.current.srcObject = localVideoStream;

      if (playTimeoutRef.current) {
        clearTimeout(playTimeoutRef.current);
        playTimeoutRef.current = null;
      }

      playTimeoutRef.current = setTimeout(() => {
        console.log("LocalVideoTest: attempting to play video");
        localVideoRef.current?.play().then(() => {
          console.log("LocalVideoTest: video play succeeded");
          setIsPlaying(true);
        }).catch((error) => {
          console.error("LocalVideoTest: video play failed with error:", error);
          setIsPlaying(false);
        });
      }, 100);
    } else {
      console.log("LocalVideoTest: videoRef or localVideoStream not ready", {
        videoRefCurrent: localVideoRef.current,
        localVideoStream
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
