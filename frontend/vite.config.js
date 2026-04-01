import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'kai-logo.png'],
      workbox: {
        skipWaiting: true,       // nuevo SW activa inmediatamente sin esperar
        clientsClaim: true,      // el nuevo SW toma control de todas las tabs
        cleanupOutdatedCaches: true,
        // Excluir rutas externas del NavigationRoute — no interceptar /deviamodel
        navigateFallbackDenylist: [/^\/api/, /^\/deviamodel/],
      },
      manifest: {
        name: 'KaiOS',
        short_name: 'KaiOS',
        description: 'Tu mano derecha técnica',
        theme_color: '#00d4aa',
        background_color: '#111118',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:80',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:80',
        ws: true,
      },
    },
  },
});
