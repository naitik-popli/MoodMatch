import { useEffect, useState, useCallback, useRef } from "react";
import { useWebSocket } from "../context/WebSocketContext";

/**
 * If wsUrl is provided, creates a new WebSocket.
 * If not, uses the shared WebSocket from context.
 */
export function useSocket(wsUrl?: string) {
  const contextWs = useWebSocket();
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const listenersRef = useRef<{ [event: string]: ((data: any) => void)[] }>({});

  useEffect(() => {
    let ws: WebSocket | null = null;
    let usingContext = false;

    if (wsUrl) {
      ws = new WebSocket(wsUrl);
      setSocket(ws);
      console.log("[useSocket] Creating new WebSocket:", wsUrl);
    } else if (contextWs) {
      ws = contextWs;
      setSocket(contextWs);
      usingContext = true;
      console.log("[useSocket] Using shared WebSocket from context");
    } else {
      setSocket(null);
      setIsConnected(false);
      console.warn("[useSocket] No WebSocket available");
      return;
    }

    if (!ws) return;

    ws.onopen = () => {
      console.log("✅ WebSocket connected:", wsUrl || "[context]");
      setIsConnected(true);
    };

    ws.onclose = (event) => {
      console.warn("⚠️ WebSocket disconnected:", event.reason);
      setIsConnected(false);
      if (!usingContext) setSocket(null);
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
    };

    ws.onmessage = (event) => {
      let data = event.data;
      try {
        if (typeof data === "string") {
          data = JSON.parse(data);
        }
      } catch (e) {
        console.warn("[useSocket] Received non-JSON message:", event.data);
      }
      // Call all listeners for 'message'
      (listenersRef.current["message"] || []).forEach((cb) => cb(data));
    };

    return () => {
      // Only close if we created it (not if using context)
      if (wsUrl && ws) {
        ws.close();
        setIsConnected(false);
        setSocket(null);
        console.log("[useSocket] Closed WebSocket:", wsUrl);
      }
      // Clean up listeners
      listenersRef.current = {};
    };
  }, [wsUrl, contextWs]);

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

      console.log(`[useSocket] Added listener for '${event}'`);

      return () => {
        listenersRef.current[event] = listenersRef.current[event].filter(
          (cb) => cb !== callback
        );
        console.log(`[useSocket] Removed listener for '${event}'`);
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