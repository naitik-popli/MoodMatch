import React, { createContext, useContext, useEffect, useState, useRef } from "react";

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

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "socket-id" && data.socketId) {
          setSocketId(data.socketId);
          console.log("[WebSocketContext] Received socketId from server:", data.socketId);
        }
      } catch (err) {
        // Ignore non-JSON or unrelated messages
      }
    };

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
  const socket = new WebSocket(WS_URL);
  setWs(socket);

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "socket-id" && data.socketId) {
        setSocketId(data.socketId);
        console.log("[WebSocketContext] Received socketId from server:", data.socketId);
      }
    } catch (err) {
      // Ignore non-JSON or unrelated messages
    }
  };

  // Ensure socket closes on page unload/reload
  const handleBeforeUnload = () => {
    socket.close();
  };
  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    socket.close();
  };
}, []);

  return (
    <WebSocketContext.Provider value={{ ws, socketId }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => useContext(WebSocketContext);