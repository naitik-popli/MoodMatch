import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { setupWebSocket } from "./websocket";
import { db } from "./db"; // Added missing import
import { sql } from "drizzle-orm"; // Added missing import
import { moodQueue } from "@shared/schema"; // Added missing import

const app = express();
const PORT = process.env.PORT || 5000;

// Enhanced CORS Configuration
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

// Improved Logger Middleware
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
  res.status(200).json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    database: process.env.DATABASE_URL_TEST ? "connected" : "disconnected"
  });
});

async function ensureSchema() {
  try {
    console.log("🛠️  Verifying database schema...");
    
    await db.execute(sql`
      ALTER TABLE mood_queue 
      DROP CONSTRAINT IF EXISTS mood_idx;
    `);
    
    await db.execute(sql`
      ALTER TABLE mood_queue 
      ADD CONSTRAINT uq_mood_queue_user UNIQUE (user_id);
    `);
    
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_mood_queue_mood 
      ON mood_queue(mood);
    `);
    
    console.log("✅ Database schema verified");
  } catch (error) {
    console.error("❌ Database schema verification failed:", error);
    throw error;
  }
}

async function startServer() {
  try {
    if (!process.env.DATABASE_URL_TEST) {
      throw new Error("DATABASE_URL_TEST environment variable is not set");
    }

    // Verify database schema before starting
    await ensureSchema();

    // Register Routes
    await registerRoutes(app);

    // HTTP Server
    const server = createServer(app);

    // Secure Socket.IO Configuration
    const io = new SocketIOServer(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        allowedHeaders: ["Authorization"],
        credentials: true
      },
      allowEIO3: true,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true
      }
    });

    setupWebSocket(io);

    // Error Handling Middleware
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error(`[${req.method}] ${req.path} Error:`, err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      });
    });

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🛡️  CORS allowed for: ${allowedOrigins.join(', ')}`);
      console.log(`💾 Database: ${process.env.DATABASE_URL_TEST ? "connected" : "disconnected"}`);
    });

  } catch (error) {
    console.error("🔥 Failed to start server:", error);
    process.exit(1);
  }
}

// Process Handlers
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
});

// Start the server
startServer().catch(err => {
  console.error("💀 Fatal error during startup:", err);
  process.exit(1);
});s