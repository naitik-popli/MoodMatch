import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { setupWebSocket } from "./websocket";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { moodQueue } from "@shared/schema";

const app = express();
const PORT = process.env.PORT || 5000;

// Enhanced CORS Configuration
const allowedOrigins = [
  'https://mood-match-825vrgvf1-naitiks-projects-caeedbd6.vercel.app',
  'https://mood-match-two.vercel.app',
  'http://localhost:3000',
  'https://mood-match-gsiu64tip-naitiks-projects-caeedbd6.vercel.app',
  'https://mood-match-one.vercel.app'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`Blocked CORS request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'my-custom-header']
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
app.get("/", (req, res) => {
  res.send("MoodMatch backend is running 🚀");
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
    
    // Check if mood_queue table exists
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'mood_queue'
      )
    `);
    
    if (!tableExists[0].exists) {
      throw new Error("mood_queue table does not exist");
    }

    // Verify table structure
    const columns = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns
      WHERE table_name = 'mood_queue'
    `);
    
    const requiredColumns = ['id', 'user_id', 'mood', 'socket_id', 'created_at'];
    for (const col of requiredColumns) {
      if (!columns.some(c => c.column_name === col)) {
        throw new Error(`Missing column: ${col}`);
      }
    }

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

    // Native WebSocket setup (NO Socket.IO)
    setupWebSocket(server);

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
});