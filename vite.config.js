import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  build: {
    sourcemap: true,
  },
  server: {
    host: true,
    watch: {
      ignored: ['**/backend/**']
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'TableOS Admin',
        short_name: 'TableOS',
        theme_color: '#1A365D',
        background_color: '#0D1117',
        display: 'standalone',
        start_url: '/admin',
        scope: '/admin',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    }),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG || "orderlli",
      project: "orderlli-customer",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
    })
  ],
  optimizeDeps: {
    exclude: ['backend']
  }
});
