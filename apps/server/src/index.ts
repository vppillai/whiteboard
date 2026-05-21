/**
 * Whiteboard server. Stateless at v1.
 *
 *   - GET /health     → liveness probe.
 *   - GET *           → static files from `${DIST_DIR}` (the built web app),
 *                       with index.html fallback for client-side routing.
 *
 * Live collaboration (the Y.js / WebSocket / SQLite stack originally
 * scoped for M3) is deferred per ADR 0012. The design is preserved at
 * docs/superpowers/specs/2026-05-10-m3-sync-design.md and returns when
 * sharing returns.
 *
 * Path-traversal defense: requests are resolved against the dist root and
 * rejected if the resolved path escapes it. Bun/WHATWG URL parsing already
 * normalizes `..` in practice, but the application-layer guard ensures the
 * invariant holds across runtime swaps, alternative routers, and proxy
 * forward-as-is configurations.
 *
 * Security headers: a baseline CSP plus the standard set (nosniff, no-
 * referrer, frame-ancestors none, permissions-policy) is attached to every
 * response. CSP allows `'unsafe-inline'` for styles because Vite injects
 * inline `<style>` blocks for the SPA shell; scripts and connect are
 * `'self'` only.
 */

import { resolve, sep } from 'node:path'

const port = Number(process.env.PORT ?? 8787)
const distDir = process.env.DIST_DIR ?? './apps/web/dist'
const distRoot = resolve(distDir)

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; " +
    "img-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; " +
    "connect-src 'self'; " +
    "font-src 'self' data:; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
}

/** Resolve a request path under distRoot. Returns null if the resolved
 *  path escapes distRoot (path traversal) or contains a NUL byte. */
function safeResolve(reqPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(reqPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const candidate = resolve(distRoot, `.${decoded}`)
  if (candidate !== distRoot && !candidate.startsWith(distRoot + sep)) return null
  return candidate
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return Response.json(
        { status: 'ok', stage: 'M2.1' },
        { headers: { ...SECURITY_HEADERS, 'cache-control': 'no-store' } },
      )
    }

    // Try to serve a literal file first.
    const reqPath = url.pathname === '/' ? '/index.html' : url.pathname
    const safe = safeResolve(reqPath)
    if (safe) {
      const direct = Bun.file(safe)
      if (await direct.exists()) {
        return new Response(direct, {
          headers: { ...cacheHeaders(reqPath), ...SECURITY_HEADERS },
        })
      }
    }

    // SPA fallback: any GET that doesn't match a file falls back to index.html.
    // Once we have client-side routing for /b/<id>, this is what makes it work.
    if (req.method === 'GET') {
      const index = Bun.file(`${distRoot}/index.html`)
      if (await index.exists()) {
        return new Response(index, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            ...SECURITY_HEADERS,
          },
        })
      }
    }

    return new Response('Not found', { status: 404, headers: SECURITY_HEADERS })
  },
})

console.info(`whiteboard/server: listening on http://localhost:${server.port}`)
console.info(`  serving static from: ${distRoot}`)

function cacheHeaders(path: string): Record<string, string> {
  // Hashed assets under /assets/* are immutable; everything else stays revalidated.
  if (path.startsWith('/assets/')) {
    return { 'cache-control': 'public, max-age=31536000, immutable' }
  }
  return { 'cache-control': 'no-cache' }
}
