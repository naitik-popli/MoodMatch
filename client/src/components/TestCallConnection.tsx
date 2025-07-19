import React, { useEffect, useState } from "react";
// import { io, Socket } from "socket.io-client";

const WS_URL = "wss://moodmatch-61xp.onrender.com";

const TestCallConnection: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const newSocket = io(WS_URL, {
      transports: ["websocket"],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on("connect", () => {
      setConnected(true);
      setLogs((logs) => [...logs, `Connected with id: ${newSocket.id}`]);
    });

    newSocket.on("disconnect", () => {
      setConnected(false);
      setLogs((logs) => [...logs, "Disconnected from server"]);
    });

    newSocket.on("connect_error", (error) => {
      setLogs((logs) => [...logs, `Connection error: ${error.message}`]);
    });

    // Listen for test signaling events
    newSocket.on("match-found", (data) => {
      setLogs((logs) => [...logs, `Match found: ${JSON.stringify(data)}`]);
    });
    

    newSocket.on("waiting-for-match", (data) => {
      setLogs((logs) => [...logs, `Waiting for match: ${JSON.stringify(data)}`]);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // For testing, join mood queue with dummy data
  const joinQueue = () => {
    if (socket && connected) {
      socket.emit("join-mood-queue", {
        userId: 9999,
        mood: "happy",
        sessionId: 12345,
      });
      setLogs((logs) => [...logs, "Sent join-mood-queue event"]);
    }
  };

  // For testing, leave mood queue
  const leaveQueue = () => {
    if (socket && connected) {
      socket.emit("leave-mood-queue");
      setLogs((logs) => [...logs, "Sent leave-mood-queue event"]);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Test Call Connection</h2>
      <p>Status: {connected ? "Connected" : "Disconnected"}</p>
      <button onClick={joinQueue} disabled={!connected}>
        Join Mood Queue
      </button>
      <button onClick={leaveQueue} disabled={!connected}>
        Leave Mood Queue
      </button>
      <div style={{ marginTop: 20, maxHeight: 300, overflowY: "auto", backgroundColor: "#f0f0f0", padding: 10 }}>
        <h3>Logs:</h3>
        {logs.map((log, idx) => (
          <div key={idx} style={{ fontFamily: "monospace", fontSize: 12 }}>
            {log}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TestCallConnection;
