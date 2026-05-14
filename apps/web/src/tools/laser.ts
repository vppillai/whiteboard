/**
 * Laser pointer tool. Ephemeral fading polyline — meant for "look at this
 * spot" gestures during presentations, not for permanent annotation. The
 * trail decays over LASER_FADE_MS and then vanishes; nothing is persisted
 * to IDB, nothing enters the op pipeline, nothing appears in exports.
 *
 * Visual: tldraw v5 laser shape (per the task brief). Color comes from a
 * dedicated `laserColor` setting (default red — matches a real laser
 * pointer's feel and tldraw's default). Color selection from the right-
 * click contextual menu uses the same curated palette as pen tool's COLOR
 * row, but sets `laserColor` (not pen `color`) so switching back to draw
 * doesn't carry the laser-red color over.
 *
 * Architecture quirk: this is the only Tool that needs a self-driving
 * animation loop, since the main render loop is `committedDirty`-gated.
 * The fade is achieved by tracking each sample's timestamp and computing
 * per-segment alpha against `performance.now()` at redraw time. While
 * any samples are alive, a `requestAnimationFrame` loop keeps marking
 * the canvas dirty so the next frame re-renders the trail with updated
 * alphas; when the last sample ages out, the RAF loop stops and one
 * final dirty-mark wipes the live layer clean.
 *
 * Color selection from the right-click menu uses the same curated palette
 * as pen tool's COLOR row, but writes to a dedicated `laserColor`
 * setting (not pen `color`) so the laser-red doesn't bleed into draw mode.
 */

import { sectionLabel } from '../menu-ui'
import { applyCamera, clearLayer } from '../render'
import { buildSwatchPalette } from '../swatchpalette'
import type { Tool, ToolContext } from './types'

export interface LaserToolDeps {
  /** Read the laser's sticky color (separate from pen color so the laser
   *  red doesn't bleed into draw mode). */
  getColor: () => string
  /** Persist the laser's sticky color after the contextual menu changes
   *  it. main.ts also calls markCommittedDirty after this. */
  setColor: (token: string) => void
}

/** How long any one sample point stays visible (ms). Tuned for "noticeable
 *  but doesn't linger" feel; tldraw uses ~2-3 s. */
const LASER_FADE_MS = 2200
/** Stroke width in CSS pixels at scale=1. Counter-scaled by the camera so
 *  the trail stays the same screen-thickness at any zoom. */
const LASER_WIDTH_PX = 4
/** Soft glow under the crisp stroke gives the "laser-y" look — a slight
 *  bloom that reads as light rather than ink. */
const LASER_GLOW_BLUR = 8

interface Sample {
  /** Board-space x. */
  x: number
  /** Board-space y. */
  y: number
  /** performance.now() at the time of the sample. Used to age the segment
   *  for the fade alpha. */
  t: number
  /** True when this sample continues a stroke (pointer was already down
   *  in the previous sample). False when this sample is the first of a
   *  NEW stroke after a pointer-up — the renderer uses this to break the
   *  polyline so disjoint strokes don't get a connecting line between
   *  them. Each pointer-up → pointer-down pair produces one `false` here. */
  continueFromPrev: boolean
}

export function createLaserTool(deps: LaserToolDeps): Tool {
  const points: Sample[] = []
  let active = false
  let rafHandle: number | null = null

  /** Cull samples older than LASER_FADE_MS (they'd be alpha=0 anyway).
   *  Returns true when at least one sample is still alive after culling. */
  const cull = (now: number): boolean => {
    while (points.length > 0) {
      const head = points[0]
      if (!head || now - head.t <= LASER_FADE_MS) break
      points.shift()
    }
    return points.length > 0
  }

  const startFadeLoop = (ctx: ToolContext): void => {
    if (rafHandle !== null) return
    const tick = (): void => {
      const now = performance.now()
      const alive = cull(now)
      // Mark dirty regardless — even when nothing is alive we need one
      // final clear pass to wipe the last frame's drawn trail.
      ctx.markCommittedDirty()
      if (!alive && !active) {
        rafHandle = null
        return
      }
      rafHandle = requestAnimationFrame(tick)
    }
    rafHandle = requestAnimationFrame(tick)
  }

  const stopFadeLoop = (): void => {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
  }

  const appendSample = (
    clientX: number,
    clientY: number,
    ctx: ToolContext,
    continueFromPrev: boolean,
  ): void => {
    const { x, y } = ctx.toBoard(clientX, clientY)
    points.push({ x, y, t: performance.now(), continueFromPrev })
  }

  return {
    id: 'laser',
    // Crosshair fits the "precise pointing" gesture better than a brush
    // preview; the trail itself is the visible indicator.
    cursor: 'crosshair',

    onPointerDown(e, ctx) {
      active = true
      // First sample of a NEW stroke. continueFromPrev = false so the
      // renderer doesn't connect it to any prior pen-up sample still
      // fading in the buffer.
      appendSample(e.clientX, e.clientY, ctx, false)
      startFadeLoop(ctx)
    },

    onPointerMove(e, ctx) {
      if (!active) return
      // Sample every move plus any coalesced sub-events so fast gestures
      // produce a continuous trail rather than dot-to-dot jumps. Bounded
      // by the natural cull on age, so we don't need a max-sample cap.
      // All samples while the pointer is down continue the same stroke.
      const coalesced = e.getCoalescedEvents?.() ?? []
      if (coalesced.length === 0) {
        appendSample(e.clientX, e.clientY, ctx, true)
      } else {
        for (const ce of coalesced) appendSample(ce.clientX, ce.clientY, ctx, true)
      }
    },

    onPointerUp(_e, _ctx) {
      active = false
      // Don't clear samples here — the RAF loop keeps fading until the
      // oldest sample times out, which is the whole point of the laser.
    },

    redraw(ctx) {
      // Live-layer only. clearLayer is the global render loop's job; we
      // re-apply the camera transform and paint each STROKE (a contiguous
      // run of samples with continueFromPrev=true) as a single polyline
      // with the average-age-driven alpha for that stroke. Drawing each
      // stroke as one path with `lineCap = 'butt'` avoids the per-segment
      // round-cap dots that read as a chain of beads at high glow blur.
      //
      // Strokes are bounded by `continueFromPrev = false` markers — the
      // first sample of every new pointer-down is one such marker. The
      // result is multiple disjoint polylines that don't get connecting
      // lines between them.
      if (points.length < 2) return
      clearLayer(ctx.liveLayer)
      applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
      const c = ctx.liveLayer.ctx
      const now = performance.now()
      const inkColor = ctx.resolveColor(deps.getColor())
      c.save()
      c.lineCap = 'butt'
      c.lineJoin = 'round'
      c.lineWidth = LASER_WIDTH_PX / ctx.camera.scale
      c.strokeStyle = inkColor
      c.shadowColor = inkColor
      c.shadowBlur = LASER_GLOW_BLUR / ctx.camera.scale

      // Walk the array and group adjacent samples into stroke-spans, where
      // a span ends just before a sample with continueFromPrev=false (or
      // at the end of the array). For each span ≥ 2 samples, draw a single
      // polyline path with alpha from the span's average age — one
      // `stroke()` call per span instead of per segment.
      let spanStart = 0
      const drawSpan = (startIdx: number, endIdxExclusive: number): void => {
        const count = endIdxExclusive - startIdx
        if (count < 2) return
        let ageSum = 0
        for (let k = startIdx; k < endIdxExclusive; k++) {
          const p = points[k]
          if (!p) return
          ageSum += now - p.t
        }
        const avgAge = ageSum / count
        const alpha = Math.max(0, 1 - avgAge / LASER_FADE_MS)
        if (alpha <= 0) return
        c.globalAlpha = alpha
        c.beginPath()
        const first = points[startIdx]
        if (!first) return
        c.moveTo(first.x, first.y)
        for (let k = startIdx + 1; k < endIdxExclusive; k++) {
          const p = points[k]
          if (!p) continue
          c.lineTo(p.x, p.y)
        }
        c.stroke()
      }
      for (let i = 1; i < points.length; i++) {
        const p = points[i]
        if (p && !p.continueFromPrev) {
          drawSpan(spanStart, i)
          spanStart = i
        }
      }
      drawSpan(spanStart, points.length)
      c.restore()
    },

    renderContextualMenu(host, dismiss, rebuild, anchor) {
      // COLOR section — sets `laserColor` (NOT pen `color`). Shared
      // palette helper (curated + customs + "+") so the visual matches
      // the standalone Color picker and every other tool's right-click
      // COLOR row. The active-state mark reflects the laser-specific
      // color so the user can see what's selected for this tool.
      host.appendChild(sectionLabel('Laser color'))
      host.appendChild(
        buildSwatchPalette({
          active: deps.getColor(),
          onPick: (c) => {
            deps.setColor(c)
            dismiss()
          },
          addAt: anchor ?? { x: 0, y: 0 },
          onPaletteChanged: () => rebuild?.(),
        }),
      )
    },

    cleanup() {
      // Switching tools mid-trail — drop the trail immediately. Leaving
      // it would either bleed visually under the next tool's render or
      // race the RAF loop against a tool that doesn't know to clear.
      active = false
      points.length = 0
      stopFadeLoop()
    },
  }
}
