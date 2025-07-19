import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0', // Allow access from other devices on the network
  },
  resolve: {
    alias: {
      '@': '/client/src',
    },
  },
  build: {
    sourcemap: true,
  },
});