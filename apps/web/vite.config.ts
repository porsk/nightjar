import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = { target: 'http://localhost:3000', changeOrigin: false }
const proxy = { '/healthz': target, '/api': target }

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
