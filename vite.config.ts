// Import necessary modules for Vite configuration
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path"; // For resolving file paths
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
// Removed 'import cors from 'cors';' as it's for the backend, not Vite config

// ---

// List of allowed origins for your backend's CORS configuration.
// This array will be used in your Node.js backend server, NOT here in Vite config.
// Keeping it here for reference to remind you where it belongs logically.
const allowedOrigins = [
  'https://moodmatch-1.onrender.com',
  "https://moodmatch-61xp.onrender.com",
  'http://localhost:3000'
];

// ---

// IMPORTANT: The following 'app.use(cors(...))' block MUST be removed from this file.
// It caused a critical error because 'app' is not defined in Vite's context.
// This code belongs in your backend server file (e.g., server.js or app.js)
// where you initialize and configure your Express (or similar) application.
/*
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
*/

// ---

// List of allowed hosts for Vite's Content Security Policy (CSP) header.
// These are the domains from which your frontend expects to load resources.
const allowedHosts = [
  "moodmatch-1.onrender.com",
  "https://moodmatch-61xp.onrender.com",
  "localhost",
  "127.0.0.1"
];

// ---

// Export the Vite configuration
export default defineConfig({
  // Configure Vite plugins
  plugins: [
    react(), // Enables React support
    runtimeErrorOverlay(), // Provides a runtime error overlay, useful for development
    // Conditionally load Replit-specific Cartographer plugin in development
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          // Dynamically import Cartographer plugin
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  // ---
  // Configure path aliases for easier imports
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"), // Alias for client-side source code
      "@shared": path.resolve(import.meta.dirname, "shared"), // Alias for shared code
      "@assets": path.resolve(import.meta.dirname, "attached_assets"), // Alias for assets
    },
  },
  // ---
  // Set the root directory for your client-side application
  root: path.resolve(import.meta.dirname, "client"),
  // ---
  // Configure the build process
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"), // Output directory for built files
    emptyOutDir: true, // Clear the output directory before building
  },
  // ---
  // Configure the development server
  server: {
    host: true, // Allow external access to the dev server
    port: 3000, // Port for the dev server
    strictPort: true, // Exit if the port is already in use
    hmr: {
      clientPort: 443, // Set the client port for Hot Module Replacement (HMR), useful for HTTPS dev environments
    },
    fs: {
      strict: true, // Restrict file system access to specified paths
      deny: ["**/.*"], // Deny access to dotfiles
    },
    // Security headers for the development server
    headers: {
      // Content Security Policy (CSP) to mitigate cross-site scripting (XSS)
      "Content-Security-Policy": `default-src 'self' ${allowedHosts.join(' ')};`,
      "X-Frame-Options": "DENY", // Prevent clickjacking by disallowing embedding in iframes
      "X-Content-Type-Options": "nosniff" // Prevent MIME-sniffing vulnerabilities
    },
    // Proxy configuration for API calls during development
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001', // Target URL for your backend API
        changeOrigin: true, // Change the origin header to the target URL
        secure: false, // Set to 'true' if your backend API is on HTTPS
        rewrite: (path) => path.replace(/^\/api/, '') // Remove '/api' prefix from the request path
      }
    }
  },
  // ---
  // Configure the preview server (for checking production build locally)
  preview: {
    host: true, // Allow external access
    port: 3000, // Port for the preview server
    strictPort: true, // Exit if the port is already in use
    // CORS headers for the preview server.
    // Note: Primary CORS handling should be on your backend.
    // These are usually only needed for specific cross-origin preview testing scenarios.
    headers: {
      // Allows requests from the first allowed host for specific preview needs
      "Access-Control-Allow-Origin": `https://${allowedHosts[0]}`,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  }
});