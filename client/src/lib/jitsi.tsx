import { useEffect, useRef, useState } from "react";

interface JitsiMeetProps {
  roomName?: string; // Optional, will generate random if not provided
  displayName: string;
}

declare global {
  interface Window {
    JitsiMeetExternalAPI?: any;
  }
}

// Utility to generate a truly random room name
function getRandomRoomName() {
  return (
    "moodmatch_" +
    Math.random().toString(36).substring(2, 10) +
    "_" +
    Date.now().toString(36)
  );
}

function loadJitsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://meet.jit.si/external_api.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Jitsi script"));
    document.head.appendChild(script);
  });
}

export default function JitsiMeet({ roomName, displayName }: JitsiMeetProps) {
  const jitsiContainerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [finalRoomName] = useState(roomName || getRandomRoomName());

  useEffect(() => {
    loadJitsiScript()
      .then(() => {
        setScriptLoaded(true);
      })
      .catch((error) => {
        console.error("[JitsiMeet] Error loading Jitsi script:", error);
      });
  }, []);

  useEffect(() => {
    if (!scriptLoaded) return;

    console.log("[JitsiMeet] Initializing JitsiMeetExternalAPI", finalRoomName, displayName);

    if (!window.JitsiMeetExternalAPI) {
      console.error("[JitsiMeet] JitsiMeetExternalAPI is NOT loaded even after script load!");
      return;
    }

    if (jitsiContainerRef.current) {
      jitsiContainerRef.current.innerHTML = "";
    }

    // Create the Jitsi Meet API instance
    const api = new window.JitsiMeetExternalAPI("meet.jit.si", {
      roomName: finalRoomName,
      parentNode: jitsiContainerRef.current,
      userInfo: { displayName },
      configOverwrite: {
        startWithAudioMuted: false,
        startWithVideoMuted: false,
        prejoinPageEnabled: false,
        enableWelcomePage: false,
        disableDeepLinking: true,
        lobbyEnabled: false,
        requireDisplayName: false,
        // These two are important for public meet.jit.si:
        membersOnly: false,
        startAudioOnly: false,
      },
      interfaceConfigOverwrite: {
        SHOW_JITSI_WATERMARK: false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        SHOW_BRAND_WATERMARK: false,
        SHOW_POWERED_BY: false,
        DEFAULT_REMOTE_DISPLAY_NAME: "Fellow MoodMatcher",
        TOOLBAR_BUTTONS: [
          "microphone", "camera", "closedcaptions", "desktop", "fullscreen",
          "fodeviceselection", "hangup", "profile", "chat", "recording",
          "livestreaming", "etherpad", "sharedvideo", "settings", "raisehand",
          "videoquality", "filmstrip", "invite", "feedback", "stats", "shortcuts",
          "tileview", "videobackgroundblur", "download", "help", "mute-everyone"
        ],
      },
    });

    api.addEventListener("videoConferenceLeft", () => {
      console.log("[JitsiMeet] videoConferenceLeft event fired");
    });

    return () => {
      api.dispose();
    };
  }, [scriptLoaded, finalRoomName, displayName]);

  return (
    <div
      ref={jitsiContainerRef}
      style={{ height: "600px", width: "100%" }}
      id="jitsi-container"
    />
  );
}