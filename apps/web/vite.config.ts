import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // Dev only: ship no source maps in production builds (Pages / Docker).
    // Vite's own default is `false`; keep maps for local debugging.
    sourcemap: mode !== 'production',
    outDir: 'dist',
  },
  base: process.env.BASE_PATH ?? '/',
}))
