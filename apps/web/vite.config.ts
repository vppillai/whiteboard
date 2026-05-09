import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
  },
  base: process.env.BASE_PATH ?? '/',
})
