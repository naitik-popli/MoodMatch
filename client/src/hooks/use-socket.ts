import { useEffect, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "../lib/api";

// Define the path used by both client and server
const SOCKET_PATH = "/socket.io";
declare global {
  interface Window {
    _globalSocket?: Socket;
  }
}

// Custom hook to manage socket connection
export function useSocket(userId?: number) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 🛑 Do nothing if no userId
    if (!userId) return;

    // Build WebSocket URL from API_BASE_URL
    let wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/?$/, "");
    const finalWsUrl = wsUrl.startsWith("ws://")
      ? wsUrl.replace(/^ws:/, "wss:")
      : wsUrl;

    console.log("🌐 API_BASE_URL:", API_BASE_URL);
    console.log("🔧 Constructed wsUrl:", wsUrl);
    console.log("🚀 Connecting to socket at:", finalWsUrl);

    // Use a global socket instance to keep connection persistent
    if (!window._globalSocket) {
      window._globalSocket = io(finalWsUrl, {
        transports: ["websocket"],
        path: SOCKET_PATH,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        timeout: 30000,
        auth: { userId: userId || "guest" },
      });
    }

    setSocket(window._globalSocket);

    // Do not disconnect socket on unmount
    return () => {
      console.log("🧹 Component unmounted, but socket connection kept alive");
    };
  }, [userId]);
         

       useEffect(() => {
    if (!socket) return;

    const handleConnect = () => {
      console.log("✅ Connected to socket:", socket.id);
      setIsConnected(true);
      socket.emit("update-socket-id", { userId });
    };
    const handleDisconnect = (reason: any) => {
      console.warn("⚠️ Socket disconnected:", reason);
      setIsConnected(false);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    // Optional: handle errors and reconnect events
    socket.on("connect_error", (error) => {
      console.error("❌ Socket connection error:", error.message || error);
    });
    socket.on("reconnect_attempt", (attempt) => {
      console.log(`🔄 Reconnect attempt #${attempt}`);
    });
    socket.on("reconnect_error", (error) => {
      console.error("❌ Reconnect error:", error);
    });
    socket.on("reconnect_failed", () => {
      console.error("❌ Reconnect failed");
    });

    // Cleanup listeners on unmount
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error");
      socket.off("reconnect_attempt");
      socket.off("reconnect_error");
      socket.off("reconnect_failed");
    };
  }, [socket, userId]);

  

  // Emit events only when connected
  const emit = useCallback(
    (event: string, data?: any) => {
      if (socket && isConnected) {
        console.log(`📤 Emitting '${event}' with data:`, data);
        socket.emit(event, data);
      } else {
        console.warn(`⚠️ Cannot emit '${event}' — socket not connected`);
      }
    },
    [socket, isConnected]
  );

  // Listen for socket events, returns unsubscribe function
  const on = useCallback(
    (event: string, callback: (data: any) => void) => {
      if (socket) {
        console.log(`👂 Subscribing to '${event}'`);
        socket.on(event, callback);

        return () => {
          console.log(`🚫 Unsubscribing from '${event}'`);
          socket.off(event, callback);
        };
      }
      // Return a no-op if socket is not ready
      return () => {};
    },
    [socket]
  );

  return {
    socket,
    isConnected,
    emit,
    on,
  };
}

export default useSocket;