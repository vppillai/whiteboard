/**
 * Smoke suite for the core whiteboard path, against the production build.
 *
 * Stroke assertions: the app exposes no window-level test hooks (state is
 * closure-encapsulated in main()), so we assert on the *committed* canvas
 * layer's pixels. A named ImageData snapshot is stashed in-page
 * (window.__e2eSnaps) and later diffed against the live canvas — counting
 * pixels whose RGB delta exceeds a small tolerance. The background grid is
 * constant across operations, so "diff vs the blank baseline" isolates
 * ink. Rendering is rAF-async, so every pixel assertion polls (bounded by
 * expect.poll's timeout) rather than sleeping.
 *
 * Key bindings used here mirror apps/web/src/keymap.ts: B = pen,
 * V = select, Shift+E = sticky eraser, Ctrl+Z / Ctrl+Shift+Z = undo /
 * redo, Ctrl+E = export popover.
 */

import { stat } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'

declare global {
  interface Window {
    __e2eSnaps: Record<string, ImageData>
  }
}

interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** Pixels that must differ before we call it "ink present". A short pen
 *  stroke paints thousands of pixels; 100 is comfortably above noise. */
const INK_MIN = 100
/** Pixels allowed to differ while still calling two states "identical".
 *  Re-renders of the same scene are deterministic, so this is ~0 with a
 *  little antialiasing headroom. */
const SAME_MAX = 12

/** First `#app canvas` is the committed layer (strokes composite);
 *  the second is the live overlay (in-flight stroke, cursors). */
const COMMITTED = '#app canvas'

/** Snapshot the committed canvas into an in-page named slot. */
async function snapshot(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    const c = document.querySelector('#app canvas') as HTMLCanvasElement
    const ctx = c.getContext('2d') as CanvasRenderingContext2D
    window.__e2eSnaps = window.__e2eSnaps ?? {}
    window.__e2eSnaps[n] = ctx.getImageData(0, 0, c.width, c.height)
  }, name)
}

/** Count pixels (optionally within a CSS-px region) whose RGB differs
 *  from the named snapshot by more than a small tolerance. */
async function diffFrom(page: Page, name: string, region?: Region): Promise<number> {
  return page.evaluate(
    ({ n, region }) => {
      const c = document.querySelector('#app canvas') as HTMLCanvasElement
      const ctx = c.getContext('2d') as CanvasRenderingContext2D
      const base = window.__e2eSnaps[n]
      if (!base) return Number.MAX_SAFE_INTEGER
      const cur = ctx.getImageData(0, 0, c.width, c.height)
      if (base.width !== cur.width || base.height !== cur.height) {
        return Number.MAX_SAFE_INTEGER
      }
      const dpr = c.width / c.clientWidth
      const sx = region ? Math.max(0, Math.floor(region.x * dpr)) : 0
      const sy = region ? Math.max(0, Math.floor(region.y * dpr)) : 0
      const ex = region ? Math.min(c.width, Math.ceil((region.x + region.w) * dpr)) : c.width
      const ey = region ? Math.min(c.height, Math.ceil((region.y + region.h) * dpr)) : c.height
      let diff = 0
      for (let y = sy; y < ey; y++) {
        for (let x = sx; x < ex; x++) {
          const i = (y * cur.width + x) * 4
          if (
            Math.abs((cur.data[i] ?? 0) - (base.data[i] ?? 0)) > 8 ||
            Math.abs((cur.data[i + 1] ?? 0) - (base.data[i + 1] ?? 0)) > 8 ||
            Math.abs((cur.data[i + 2] ?? 0) - (base.data[i + 2] ?? 0)) > 8
          ) {
            diff++
          }
        }
      }
      return diff
    },
    { n: name, region },
  )
}

/** FNV-1a hash of a CSS-px region of the committed canvas. Survives page
 *  reloads (unlike in-page snapshots), so the persistence test can compare
 *  pre/post-reload pixels. Camera + theme persist per device, so the same
 *  scene re-renders pixel-identically. */
async function regionHash(page: Page, region: Region): Promise<string> {
  return page.evaluate((r) => {
    const c = document.querySelector('#app canvas') as HTMLCanvasElement
    const ctx = c.getContext('2d') as CanvasRenderingContext2D
    const dpr = c.width / c.clientWidth
    const img = ctx.getImageData(
      Math.floor(r.x * dpr),
      Math.floor(r.y * dpr),
      Math.floor(r.w * dpr),
      Math.floor(r.h * dpr),
    )
    let h = 0x811c9dc5
    for (let i = 0; i < img.data.length; i++) {
      h = Math.imul(h ^ (img.data[i] ?? 0), 0x01000193) >>> 0
    }
    return h.toString(16)
  }, region)
}

/** Load the board and wait until the first paint settles (two consecutive
 *  committed-canvas frames identical) — an app signal, not a fixed sleep. */
async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForSelector(COMMITTED)
  await expect
    .poll(
      async () => {
        await snapshot(page, '__stability')
        await page.waitForTimeout(120)
        return diffFrom(page, '__stability')
      },
      { timeout: 10_000 },
    )
    .toBe(0)
}

/** Drag a pen stroke with the synthetic mouse (the pointer router accepts
 *  mouse pointers the same as pen). */
async function drawStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.keyboard.press('b')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
}

/** Resolve the IndexedDB stroke count ('whiteboard-local' → 'strokes'). */
async function idbStrokeCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolveCount, reject) => {
        const open = indexedDB.open('whiteboard-local')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          try {
            const count = db.transaction('strokes', 'readonly').objectStore('strokes').count()
            count.onsuccess = () => {
              db.close()
              resolveCount(count.result)
            }
            count.onerror = () => {
              db.close()
              reject(count.error)
            }
          } catch (err) {
            db.close()
            reject(err)
          }
        }
      }),
  )
}

test('boots clean: canvas present, no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    errors.push(String(err))
  })
  await gotoBoard(page)
  await expect(page.locator(COMMITTED).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('pen stroke draws ink; undo reverts; redo restores', async ({ page }) => {
  await gotoBoard(page)
  await snapshot(page, 'blank')

  await drawStroke(page, { x: 220, y: 220 }, { x: 420, y: 320 })
  await expect.poll(() => diffFrom(page, 'blank')).toBeGreaterThan(INK_MIN)
  await snapshot(page, 'inked')

  await page.keyboard.press('Control+KeyZ')
  await expect.poll(() => diffFrom(page, 'blank')).toBeLessThan(SAME_MAX)

  await page.keyboard.press('Control+Shift+KeyZ')
  await expect.poll(() => diffFrom(page, 'inked')).toBeLessThan(SAME_MAX)
})

test('eraser removes the stroke (object-erase tap)', async ({ page }) => {
  await gotoBoard(page)
  await snapshot(page, 'blank')

  await drawStroke(page, { x: 220, y: 220 }, { x: 420, y: 320 })
  await expect.poll(() => diffFrom(page, 'blank')).toBeGreaterThan(INK_MIN)

  // Sticky eraser; a Shift-tap object-erases the topmost stroke (the
  // eraser's gesture mode is wipe by default — Shift overrides to object).
  await page.keyboard.press('Shift+E')
  await page.mouse.move(320, 270)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(() => diffFrom(page, 'blank')).toBeLessThan(SAME_MAX)
})

test('select tool drags the stroke to a new position', async ({ page }) => {
  await gotoBoard(page)
  await snapshot(page, 'blank')

  await drawStroke(page, { x: 240, y: 240 }, { x: 360, y: 300 })
  const regionA: Region = { x: 180, y: 180, w: 240, h: 180 }
  await expect.poll(() => diffFrom(page, 'blank', regionA)).toBeGreaterThan(INK_MIN)

  // Grab the stroke at its midpoint and drag it +320/+200.
  await page.keyboard.press('v')
  await page.mouse.move(300, 270)
  await page.mouse.down()
  await page.mouse.move(620, 470, { steps: 15 })
  await page.mouse.up()
  // Clear the selection overlay so it doesn't pollute the pixel regions.
  await page.keyboard.press('Escape')

  const regionB: Region = { x: 520, y: 400, w: 220, h: 140 }
  await expect.poll(() => diffFrom(page, 'blank', regionA)).toBeLessThan(SAME_MAX)
  await expect.poll(() => diffFrom(page, 'blank', regionB)).toBeGreaterThan(INK_MIN)
})

test('PNG export downloads a non-empty file', async ({ page }) => {
  await gotoBoard(page)
  await drawStroke(page, { x: 220, y: 220 }, { x: 420, y: 320 })
  await snapshot(page, 'blank')

  const downloadPromise = page.waitForEvent('download')
  await page.keyboard.press('Control+KeyE')
  await page.locator('.whiteboard-export-pill[data-format="png"]').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/\.png$/)
  const file = await download.path()
  expect((await stat(file)).size).toBeGreaterThan(100)
})

test('stroke survives a page reload (IndexedDB persistence)', async ({ page }) => {
  await gotoBoard(page)
  await snapshot(page, 'blank')

  await drawStroke(page, { x: 260, y: 240 }, { x: 430, y: 330 })
  const region: Region = { x: 220, y: 200, w: 260, h: 180 }
  await expect.poll(() => diffFrom(page, 'blank', region)).toBeGreaterThan(INK_MIN)
  await expect.poll(() => idbStrokeCount(page)).toBeGreaterThan(0)
  const inkedHash = await regionHash(page, region)

  await page.reload()
  await page.waitForSelector(COMMITTED)
  await expect.poll(() => regionHash(page, region), { timeout: 10_000 }).toBe(inkedHash)
})
