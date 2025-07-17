import { useEffect, useState, useCallback, useRef } from "react";

export function useSocket(wsUrl?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const listenersRef = useRef<{ [event: string]: ((data: any) => void)[] }>({});

  useEffect(() => {
    if (!wsUrl) return;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("✅ WebSocket connected:", wsUrl);
      setIsConnected(true);
    };

    ws.onclose = (event) => {
      console.warn("⚠️ WebSocket disconnected:", event.reason);
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
    };

    ws.onmessage = (event) => {
      let data = event.data;
      // Try to parse JSON if possible
      try {
        if (typeof data === "string") {
          data = JSON.parse(data);
        }
      } catch (e) {
        // Not JSON, leave as is
      }
      // Call all listeners for 'message'
      (listenersRef.current["message"] || []).forEach((cb) => cb(data));
    };

    setSocket(ws);

    return () => {
      ws.close();
      setIsConnected(false);
      setSocket(null);
    };
  }, [wsUrl]);

  // Emit/send data
  const emit = useCallback(
    (data: any) => {
      if (socket && isConnected) {
        const msg = typeof data === "string" ? data : JSON.stringify(data);
        console.log("📤 WebSocket sending:", msg);
        socket.send(msg);
      } else {
        console.warn("⚠️ Cannot send — WebSocket not connected");
      }
    },
    [socket, isConnected]
  );

  // Listen for 'message' events
  const on = useCallback(
    (event: "message", callback: (data: any) => void) => {
      if (!listenersRef.current[event]) {
        listenersRef.current[event] = [];
      }
      listenersRef.current[event].push(callback);

      return () => {
        listenersRef.current[event] = listenersRef.current[event].filter(
          (cb) => cb !== callback
        );
      };
    },
    []
  );

  return {
    socket,
    isConnected,
    emit,
    on,
  };
}

export default useSocket;