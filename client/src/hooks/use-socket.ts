import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_WS_URL || "wss://moodmatch-61xp.onrender.com";

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const userIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!socketRef.current) {
      const newSocket = io(SOCKET_URL, {
        transports: ["websocket"],
        autoConnect: false,
      });
      socketRef.current = newSocket;
      setSocket(newSocket);
    }

    const socket = socketRef.current;

    const onConnect = () => {
      setConnected(true);
      console.log("[SOCKET] Connected:", socket?.id);
      // Emit update-socket-id event on connect if userId is available
      if (socket && userIdRef.current) {
        socket.emit("update-socket-id", { userId: userIdRef.current });
        console.log(`[SOCKET] Emitted update-socket-id for userId: ${userIdRef.current}`);
      }
    };

    const onDisconnect = () => {
      setConnected(false);
      console.log("[SOCKET] Disconnected");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.disconnect();
    };
  }, []);

  // Emit event with data
  const emit = (event: string, data?: any) => {
    if (socket && connected) {
      socket.emit(event, data);
      console.log(`[SOCKET] Emitted event: ${event}`, data);
      if (event === "update-socket-id" && data?.userId) {
        userIdRef.current = data.userId;
      }
    } else {
      console.warn(`[SOCKET] Cannot emit, socket not connected: ${event}`);
    }
  };

  // Listen for event
  const on = (event: string, callback: (...args: any[]) => void) => {
    if (socket) {
      socket.on(event, callback);
      console.log(`[SOCKET] Listening for event: ${event}`);
    }
  };

  // Remove event listener
  const off = (event: string, callback: (...args: any[]) => void) => {
    if (socket) {
      socket.off(event, callback);
      console.log(`[SOCKET] Removed listener for event: ${event}`);
    }
  };

  return { socket, connected, emit, on, off };
}
