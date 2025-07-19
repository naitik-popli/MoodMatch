import React, { createContext, useContext, useEffect, useState } from "react";

const WS_URL = "wss://moodmatch-61xp.onrender.com";

type WebSocketContextType = {
  ws: WebSocket | null;
  socketId: string | null;
};

const WebSocketContext = createContext<WebSocketContextType>({
  ws: null,
  socketId: null,
});

export const WebSocketProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [socketId, setSocketId] = useState<string | null>(null);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    setWs(socket);

    socket.onopen = () => {
      console.log("[WebSocketContext] WebSocket connection opened");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "socket-id" && data.socketId) {
          setSocketId(data.socketId);
          console.log("[WebSocketContext] Received socketId from server:", data.socketId);
        } else {
          console.log("[WebSocketContext] Received message:", data);
        }
      } catch (err) {
        console.warn("[WebSocketContext] Failed to parse message:", event.data, err);
      }
    };

    socket.onerror = (err) => {
      console.error("[WebSocketContext] WebSocket error:", err);
    };

    socket.onclose = (event) => {
      if (event.code !== 1000) { // 1000 = normal closure
        console.log("[WebSocketContext] WebSocket closed unexpectedly:", event.code, event.reason);
      } else {
        console.log("[WebSocketContext] WebSocket closed:", event.code, event.reason);
      }
      setWs(null);
      setSocketId(null);
    };

    // Ensure socket closes on page unload/reload
    const handleBeforeUnload = () => {
      console.log("[WebSocketContext] Closing WebSocket due to page unload");
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      console.log("[WebSocketContext] Cleaning up WebSocket connection");
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ ws, socketId }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => useContext(WebSocketContext);