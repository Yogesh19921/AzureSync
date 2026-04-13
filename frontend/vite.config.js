import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3421,
    proxy: {
      '/api': 'http://localhost:3420',
      '/ws': { target: 'ws://localhost:3420', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyDirBefore: true,
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
