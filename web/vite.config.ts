import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em dev, /api vai para a API (em produção a API serve este build).
// envDir na raiz: o front lê só as variáveis VITE_* do mesmo .env da API.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
})
