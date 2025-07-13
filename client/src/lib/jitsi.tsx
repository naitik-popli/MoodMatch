import { useEffect, useRef } from "react";

interface JitsiMeetProps {
  roomName: string;
  displayName: string;
}

export default function JitsiMeet({ roomName, displayName }: JitsiMeetProps) {
const jitsiContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // @ts-ignore
    if (window.JitsiMeetExternalAPI) {
      // Clean up previous iframes
      if (jitsiContainerRef.current) {
        jitsiContainerRef.current.innerHTML = "";
      }
      // @ts-ignore
      const api = new window.JitsiMeetExternalAPI("meet.jit.si", {
        roomName,
        parentNode: jitsiContainerRef.current,
        userInfo: { displayName },
        configOverwrite: {
          startWithAudioMuted: false,
          startWithVideoMuted: false,
        },
        interfaceConfigOverwrite: {
          // You can customize the UI here
        },
      });
      // Optional: handle events
      api.addEventListener("videoConferenceLeft", () => {
        // Handle leaving the meeting
      });
      return () => api.dispose();
    }
  }, [roomName, displayName]);

  return <div ref={jitsiContainerRef} style={{ height: "600px", width: "100%" }} />;
}
