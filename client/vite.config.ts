import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': '/client/src',
      'stream': 'stream-browserify',
      'events': 'events',
      'buffer': 'buffer',
      'process': 'process/browser',
    },
  },
  define: {
    'process.env': {},
  },
  build: {
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['simple-peer', 'buffer', 'process', 'stream-browserify', 'events'],
  },
});