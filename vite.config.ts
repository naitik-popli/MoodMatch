import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true, // Listen on all network interfaces
    port: 3000,
    strictPort: true,
    hmr: {
      clientPort: 443, // Important for Render's HTTPS proxy
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    allowedHosts: [
      "moodmatch-1.onrender.com",
      "localhost", // Keep local development access
    ],
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: true,
  },
});