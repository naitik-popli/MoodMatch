import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  server: {
    port: 3000,
    host: '0.0.0.0', // Allow access from other devices on the network
  },
  resolve: {
    alias: {
      '@': '/client/src',
    },
  },
  optimizeDeps: {
    include: ['simple-peer'],
  },
});
