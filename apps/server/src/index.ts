/**
 * Whiteboard server.
 *
 * M0 scope:
 *   - GET /health     → liveness probe.
 *   - GET *           → static files from `${DIST_DIR}` (the built web app),
 *                       with index.html fallback for client-side routing.
 *
 * The Y.js / WebSocket / SQLite stack lands at milestone M3.
 */

const port = Number(process.env.PORT ?? 8787)
const distDir = process.env.DIST_DIR ?? './apps/web/dist'
const ownerToken = process.env.OWNER_TOKEN ?? ''

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', stage: 'M0' })
    }

    // Try to serve a literal file first.
    const reqPath = url.pathname === '/' ? '/index.html' : url.pathname
    const direct = Bun.file(`${distDir}${reqPath}`)
    if (await direct.exists()) {
      return new Response(direct, {
        headers: cacheHeaders(reqPath),
      })
    }

    // SPA fallback: any GET that doesn't match a file falls back to index.html.
    // Once we have client-side routing for /b/<id>, this is what makes it work.
    if (req.method === 'GET') {
      const index = Bun.file(`${distDir}/index.html`)
      if (await index.exists()) {
        return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
    }

    return new Response('Not found', { status: 404 })
  },
})

console.info(`whiteboard/server: listening on http://localhost:${server.port}`)
console.info(`  serving static from: ${distDir}`)
console.info(`  owner token:         ${ownerToken ? '(set)' : '(unset — admin disabled)'}`)

function cacheHeaders(path: string): Record<string, string> {
  // Hashed assets under /assets/* are immutable; everything else stays revalidated.
  if (path.startsWith('/assets/')) {
    return { 'cache-control': 'public, max-age=31536000, immutable' }
  }
  return { 'cache-control': 'no-cache' }
}
