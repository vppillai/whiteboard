// Whiteboard server entry point.
// Pre-M0: a placeholder HTTP server. The Y.js / WebSocket / SQLite stack lands at milestone M3.
// See SPEC.md and docs/milestones.md.

const port = Number(process.env.PORT ?? 8787)

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', stage: 'pre-M0' })
    }
    return new Response('Whiteboard server: pre-M0 placeholder. See README for status.\n', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
})

console.info(`whiteboard/server: listening on http://localhost:${server.port} (pre-M0 placeholder)`)
