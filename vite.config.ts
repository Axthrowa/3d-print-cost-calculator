import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // three.js yalnizca STL goruntuleyici acildiginda gerekir; onu
          // dinamik parcanin icinde birakmak icin vendor'a alma.
          if (id.includes('node_modules/three')) return undefined;
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    // Masaüstü penceresi dışında hiçbir yerde açılmasın: Tauri kabuğu bu
    // sunucuyu kendi penceresine yükler, sistem tarayıcısı devreye girmez.
    open: false,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
