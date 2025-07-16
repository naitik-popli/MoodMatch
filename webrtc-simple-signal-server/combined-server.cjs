import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let clients = [];

app.use(express.static(path.join(__dirname)));

wss.on('connection', (ws) => {
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

const PORT = process.env.PORT || 8081;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
