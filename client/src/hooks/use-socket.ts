import { useEffect, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "../lib/api";

// Global socket path
const SOCKET_PATH = "/socket.io";

export function useSocket(userId?: number) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Ensure we don't try to connect without userId
    if (!userId) {
      console.warn("⚠️ useSocket called without userId");
      return;
    }

    // 1. Build WebSocket URL from API_BASE_URL
    let wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/?$/, "");
    console.log("🌐 API_BASE_URL:", API_BASE_URL);
    console.log("🔧 Constructed wsUrl:", wsUrl);

    // 2. Enforce wss in production
    const finalWsUrl = wsUrl.startsWith("ws://")
      ? wsUrl.replace(/^ws:/, "wss:")
      : wsUrl;

    console.log("🚀 Connecting to socket at:", finalWsUrl);

    // 3. Create socket connection
    const newSocket = io(finalWsUrl, {
      transports: ["websocket"],
      path: SOCKET_PATH,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      forceNew: true,
      auth: {
        userId: userId || "guest",
      },
    });

    // 4. Event handlers
    const handleConnect = () => {
      console.log("✅ Connected to socket:", newSocket.id);
      setIsConnected(true);

      if (userId) {
        console.log("📮 Emitting update-socket-id with userId:", userId);
        newSocket.emit("update-socket-id", { userId });
      }
    };

    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      console.warn("⚠️ Disconnected:", reason);
      setIsConnected(false);
    };

    const handleConnectError = (error: any) => {
      console.error("❌ Connection error:", error.message || error);
    };

    const handleReconnectAttempt = (attempt: number) => {
      console.warn(`🔄 Reconnect attempt #${attempt}`);
    };

    const handleReconnectFailed = () => {
      console.error("❌ Reconnection failed. Giving up.");
    };

    const handleReconnectSuccess = (attempt: number) => {
      console.log(`✅ Reconnected successfully on attempt #${attempt}`);
    };

    // 5. Bind listeners
    newSocket.on("connect", handleConnect);
    newSocket.on("disconnect", handleDisconnect);
    newSocket.on("connect_error", handleConnectError);
    newSocket.on("reconnect_attempt", handleReconnectAttempt);
    newSocket.on("reconnect_failed", handleReconnectFailed);
    newSocket.on("reconnect", handleReconnectSuccess);

    // 6. Save the socket
    setSocket(newSocket);

    // 7. Cleanup
    return () => {
      console.log("🧹 Cleaning up socket connection");
      newSocket.off("connect", handleConnect);
      newSocket.off("disconnect", handleDisconnect);
      newSocket.off("connect_error", handleConnectError);
      newSocket.off("reconnect_attempt", handleReconnectAttempt);
      newSocket.off("reconnect_failed", handleReconnectFailed);
      newSocket.off("reconnect", handleReconnectSuccess);

      if (newSocket.connected) {
        newSocket.disconnect();
        console.log("🛑 Socket disconnected");
      }
    };
  }, [userId]);

  // 8. Emit utility
  const emit = useCallback(
    (event: string, data?: any) => {
      if (socket && isConnected) {
        console.log(`📤 Emitting '${event}' with:`, data);
        socket.emit(event, data);
      } else {
        console.warn(`⚠️ Cannot emit '${event}' - socket not connected`);
      }
    },
    [socket, isConnected]
  );

  // 9. On utility
  const on = useCallback(
    (event: string, callback: (data: any) => void) => {
      if (socket) {
        console.log(`👂 Listening to '${event}'`);
        socket.on(event, callback);
        return () => {
          console.log(`🚫 Stopped listening to '${event}'`);
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
