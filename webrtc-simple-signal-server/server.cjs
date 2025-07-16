const WebSocket = require('ws');
const server = new WebSocket.Server({ port: 3000 });

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
});

console.log('WebSocket signaling server running on ws://localhost:3000');
