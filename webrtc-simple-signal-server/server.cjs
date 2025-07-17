const WebSocket = require('ws');

const port = process.env.PORT || 3000;
const server = new WebSocket.Server({ port });

let clients = [];

server.on('connection', (ws) => {
  clients.push(ws);
  console.log('Client connected. Total clients:', clients.length);

  ws.on('message', (message) => {
    // Broadcast the message to all other clients
    clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    clients = clients.filter(client => client !== ws);
    console.log('Client disconnected. Total clients:', clients.length);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

server.on('listening', () => {
  console.log(`WebSocket signaling server running on wss://moodmatch-61xp.onrender.com (port ${port})`);
});

server.on('error', (err) => {
  console.error('WebSocket server error:', err);
});