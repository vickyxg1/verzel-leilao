import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em dev, /api e /socket.io vão para a API (em produção a API serve este build).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
})
