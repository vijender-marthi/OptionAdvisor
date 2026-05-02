import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4200,
    proxy: {
      '/api': {
        target: 'http://localhost:9000',
        changeOrigin: true,
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor'
          if (id.includes('recharts')) return 'recharts'
          if (id.includes('jspdf')) return 'jspdf'
          if (id.includes('xlsx')) return 'xlsx'
          if (id.includes('lucide-react')) return 'lucide'
        },
      },
    },
  },
})
