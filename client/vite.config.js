import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
          three: ['three'],
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setupTests.js'],
    globals: true,
  },
});
