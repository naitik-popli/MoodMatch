import { useEffect, useRef, useState } from "react";

interface JitsiMeetProps {
  roomName: string;
  displayName: string;
}

declare global {
  interface Window {
    JitsiMeetExternalAPI?: any;
  }
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

    console.log("[JitsiMeet] Initializing JitsiMeetExternalAPI", roomName, displayName);
    // @ts-ignore
    if (!window.JitsiMeetExternalAPI) {
      console.error("[JitsiMeet] JitsiMeetExternalAPI is NOT loaded even after script load!");
      return;
    }
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
        prejoinPageEnabled: false,
        enableWelcomePage: false,
        disableDeepLinking: true,
      },
      interfaceConfigOverwrite: {
        // You can customize the UI here
        SHOW_JITSI_WATERMARK: false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        SHOW_BRAND_WATERMARK: false,
        SHOW_POWERED_BY: false,
        DEFAULT_REMOTE_DISPLAY_NAME: 'Fellow MoodMatcher',
        TOOLBAR_BUTTONS: [
          'microphone', 'camera', 'closedcaptions', 'desktop', 'fullscreen',
          'fodeviceselection', 'hangup', 'profile', 'chat', 'recording',
          'livestreaming', 'etherpad', 'sharedvideo', 'settings', 'raisehand',
          'videoquality', 'filmstrip', 'invite', 'feedback', 'stats', 'shortcuts',
          'tileview', 'videobackgroundblur', 'download', 'help', 'mute-everyone'
        ],
      },
    });
    // Optional: handle events
    api.addEventListener("videoConferenceLeft", () => {
      // Handle leaving the meeting
    });
    return () => api.dispose();
  }, [scriptLoaded, roomName, displayName]);

  return <div ref={jitsiContainerRef} style={{ height: "600px", width: "100%" }} />;
}
