import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    minify: true,
    cssMinify: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        app: path.resolve(rootDir, 'index.html'),
        auth: path.resolve(rootDir, 'auth.html'),
        admin: path.resolve(rootDir, 'admin.html')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  },
  server: {
    port: 5173,
    host: true /*,
    proxy: {
      '/api': {
        target: 'http://localhost:3002', 
        changeOrigin: true,
        secure: false
      }
    }*/
  }
});
