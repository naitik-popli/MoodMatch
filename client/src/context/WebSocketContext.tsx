import React, { createContext, useContext, useEffect, useRef, useState } from "react";

const WS_URL = "wss://moodmatch-61xp.onrender.com";

const WebSocketContext = createContext<WebSocket | null>(null);

export const WebSocketProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    setWs(socket);
    return () => {
      socket.close();
    };
  }, []);

  return (
    <WebSocketContext.Provider value={ws}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => useContext(WebSocketContext);