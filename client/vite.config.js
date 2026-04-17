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
    // W0.2 — "hidden" generates source maps for Sentry symbolication but
    // does NOT emit //# sourceMappingURL=... references in the shipped
    // bundle. The .map files are uploaded to Sentry at deploy time and
    // scrubbed from dist/ by CI before the bundle is served.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
          three: ['three'],
          vendor: ['react', 'react-dom'],
        },
      },
    },
    // Target modern browsers for smaller output (no legacy polyfills)
    target: 'es2020',
    // Reduce CSS output size
    cssMinify: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setupTests.js'],
    globals: true,
  },
});
