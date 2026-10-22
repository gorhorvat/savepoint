import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
// Saved data and server caches change while the app runs; they aren't source files.
const notSource = [path.join(root, 'data'), path.join(root, '.cache')].map((d) => d + path.sep)

export default defineConfig({
  plugins: [react()],
  server: {
    watch: { ignored: (file: string) => notSource.some((d) => path.normalize(file).startsWith(d)) },
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT || 8787}`,
    },
  },
})
