import { useEffect, useRef } from "react";

interface JitsiMeetProps {
  roomName: string;
  displayName: string;
}
declare global {
  interface Window {
    JitsiMeetExternalAPI?: any;
  }
}
export default function JitsiMeet({ roomName, displayName }: JitsiMeetProps) {
  const jitsiContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log("[JitsiMeet] Mounting JitsiMeet component");
    if (!window.JitsiMeetExternalAPI) {
      console.error(
        "[JitsiMeet] JitsiMeetExternalAPI is NOT loaded! Did you include the script in index.html?"
      );
      return;
    }
    if (!jitsiContainerRef.current) {
      console.error("[JitsiMeet] jitsiContainerRef is null!");
      return;
    }
    try {
      jitsiContainerRef.current.innerHTML = "";
      const api = new window.JitsiMeetExternalAPI("meet.jit.si", {
        roomName,
        parentNode: jitsiContainerRef.current,
        userInfo: { displayName },
        configOverwrite: {
          startWithAudioMuted: false,
          startWithVideoMuted: false,
        },
        interfaceConfigOverwrite: {
          // Customize UI if needed
        },
      });
      api.addEventListener("videoConferenceLeft", () => {
        console.log("[JitsiMeet] videoConferenceLeft event fired");
      });
      return () => {
        console.log("[JitsiMeet] Disposing JitsiMeetExternalAPI instance");
        api.dispose();
      };
    } catch (err) {
      console.error("[JitsiMeet] Error creating JitsiMeetExternalAPI:", err);
    }
  }, [roomName, displayName]);

  return (
    <div
      ref={jitsiContainerRef}
      style={{ height: "600px", width: "100%" }}
      id="jitsi-container"
    />
  );
}