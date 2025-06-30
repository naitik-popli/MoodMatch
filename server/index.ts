import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { setupWebSocket } from "./websocket";

const app = express();
const PORT = process.env.PORT || 5000; // Changed to use environment variable

// 1. Enhanced CORS Configuration
const allowedOrigins = [
  'https://mood-match-two.vercel.app',
  'http://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 2. Improved Logger Middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let responseBody: any;

  const originalJson = res.json;
  res.json = function(body) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${path} ${res.statusCode} ${duration}ms`);
    if (responseBody) {
      console.debug('Response:', JSON.stringify(responseBody, null, 2));
    }
  });

  next();
});

// Health Check Route
app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

async function startServer() {
  try {
    if (!process.env.DATABASE_URL_TEST) {
      throw new Error("DATABASE_URL_TEST environment variable is not set");
    }

    // Register Routes
    await registerRoutes(app);

    // HTTP Server
    const server = createServer(app);

    // 3. Secure Socket.IO Configuration
    const io = new SocketIOServer(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        allowedHeaders: ["Authorization"],
        credentials: true
      },
      allowEIO3: true,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
      }
    });

    setupWebSocket(io);

    // Error Handling Middleware (moved after route registration)
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error(`[${req.method}] ${req.path} Error:`, err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error'
      });
    });

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🛡️  CORS allowed for: ${allowedOrigins.join(', ')}`);
    });

  } catch (error) {
    console.error("🔥 Failed to start server:", error);
    process.exit(1);
  }
}

// Process Handlers
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
  // Consider implementing graceful shutdown here
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
});

startServer();