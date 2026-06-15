import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5801,
    proxy: {
      '/api': {
        target: 'http://localhost:5900',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://localhost:5900',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})