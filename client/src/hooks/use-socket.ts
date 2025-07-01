import { useEffect, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "../lib/api";

export function useSocket(userId?: number) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 1. Construct the WebSocket URL
    let wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/?$/, "");

    // 🔍 Debug - show what URL we're about to connect to
    console.log("🌐 Initial API_BASE_URL:", API_BASE_URL);
    console.log("🔧 Processed wsUrl:", wsUrl);

    // 2. Use static IP for dev if needed
    const finalWsUrl = wsUrl.includes("192.168.")
      ? wsUrl
      : wsUrl.replace(/^ws:/, "wss:");

    console.log("🚀 Connecting to socket at:", finalWsUrl);

    // 3. Create socket connection with options
    const newSocket = io(finalWsUrl, {
      transports: ["websocket"],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      forceNew: true,
      path: "/socket.io",
      rejectUnauthorized: false,
      auth: {
        userId: userId || "guest", // for debugging who’s connecting
      },
    });

    // 4. Connection Events
    const handleConnect = () => {
  console.log("✅ Connected to socket:", newSocket.id);
  setIsConnected(true);

  // ⬅️ Send userId to server to register this socket
  if (userId) {
    console.log(`📮 Sending "update-socket-id" with userId: ${userId}`);
    newSocket.emit("update-socket-id", { userId });
  } else {
    console.warn("⚠️ No userId available to send with 'update-socket-id'");
  }
};


    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      console.warn("⚠️ Disconnected from socket:", reason);
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

    // 5. Bind all listeners
    newSocket.on("connect", handleConnect);
    newSocket.on("disconnect", handleDisconnect);
    newSocket.on("connect_error", handleConnectError);
    newSocket.on("reconnect_attempt", handleReconnectAttempt);
    newSocket.on("reconnect_failed", handleReconnectFailed);
    newSocket.on("reconnect", handleReconnectSuccess);

    // 6. Save the socket reference
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
        console.log("🛑 Socket disconnected manually");
      }
    };
  }, [userId]);

  // 8. Emit event with debugging
  const emit = useCallback(
    (event: string, data?: any) => {
      if (socket && isConnected) {
        console.log(`📤 Emitting [${event}] with data:`, data);
        socket.emit(event, data);
      } else {
        console.warn(`⚠️ Tried to emit [${event}] but socket is not connected.`);
      }
    },
    [socket, isConnected]
  );

  // 9. Subscribe to event
  const on = useCallback(
    (event: string, callback: (data: any) => void) => {
      if (socket) {
        console.log(`👂 Listening for [${event}]`);
        socket.on(event, callback);
        return () => {
          console.log(`🚫 Stopped listening to [${event}]`);
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
