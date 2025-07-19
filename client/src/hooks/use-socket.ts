import { useEffect, useRef, useCallback } from "react";
import { useWebSocket } from "../context/WebSocketContext";

/**
 * Always uses the shared WebSocket from context.
 */
export function useSocket() {
  // FIX: Destructure ws from context
  const { ws } = useWebSocket();
  const listenersRef = useRef<{ [event: string]: ((data: any) => void)[] }>({});

  // Listen for 'message' events
  useEffect(() => {
    if (!ws) {
      console.warn("[useSocket] No WebSocket available for listener");
      return;
    }

    const handler = (event: MessageEvent) => {
      let data = event.data;
      try {
        if (typeof data === "string") {
          data = JSON.parse(data);
        }
      } catch (e) {
        console.warn("[useSocket] Received non-JSON message:", event.data);
      }
      console.log("[useSocket] Incoming message data:", data);
      (listenersRef.current["message"] || []).forEach((cb) => cb(data));
    };
    ws.addEventListener("message", handler);
    console.log("[useSocket] Added message listener");

    return () => {
      ws.removeEventListener("message", handler);
      console.log("[useSocket] Removed message listener and cleaned up");
    };
  }, [ws]);

  // Emit/send data
  const emit = useCallback(
    (data: any) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const msg = typeof data === "string" ? data : JSON.stringify(data);
        console.log("📤 WebSocket sending:", msg);
        ws.send(msg);
      } else {
        console.warn("⚠️ Cannot send — WebSocket not connected");
      }
    },
    [ws]
  );

  // Register a message listener
  const on = useCallback(
    (event: "message", callback: (data: any) => void) => {
      if (!listenersRef.current[event]) {
        listenersRef.current[event] = [];
      }
      listenersRef.current[event].push(callback);
      console.log(`[useSocket] Added listener for '${event}'`);

      return () => {
        if (listenersRef.current[event]) {
          listenersRef.current[event] = listenersRef.current[event].filter(
            (cb) => cb !== callback
          );
          if (listenersRef.current[event].length === 0) {
            delete listenersRef.current[event];
          }
        }
        console.log(`[useSocket] Removed listener for '${event}'`);
      };
    },
    []
  );

  return {
    ws,
    isConnected: ws?.readyState === WebSocket.OPEN,
    emit,
    on,
  };
}