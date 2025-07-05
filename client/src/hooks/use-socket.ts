import { useEffect, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "../lib/api";

// Define the path used by both client and server
const SOCKET_PATH = "/socket.io";

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

    // Create the socket connection
    const newSocket = io(finalWsUrl, {
      transports: ["websocket"],
      path: SOCKET_PATH,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
      auth: { userId: userId || "guest" },
    });

    // Handle successful connection
    newSocket.on("connect", () => {
      console.log("✅ Connected to socket:", newSocket.id);
      setIsConnected(true);

      // Send user ID to backend for identification
      newSocket.emit("update-socket-id", { userId });
    });

    // Handle disconnection
    newSocket.on("disconnect", (reason) => {
      console.warn("⚠️ Socket disconnected:", reason);
      setIsConnected(false);
    });

    // Handle connection errors
    newSocket.on("connect_error", (error) => {
      console.error("❌ Socket connection error:", error.message || error);
    });

    // Save the socket instance to state
    setSocket(newSocket);

    // Clean up socket connection on component unmount
    return () => {
      console.log("🧹 Cleaning up socket connection");
      newSocket.disconnect();
    };
  }, [userId]);

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

  // Listen for socket events
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
