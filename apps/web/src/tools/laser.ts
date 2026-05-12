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

import { CURATED_COLORS as PALETTE } from '../colorpicker'
import { paletteGrid, sectionLabel, swatch } from '../menu-ui'
import { applyCamera, clearLayer } from '../render'
import { getLaserColor, setLaserColor } from '../settings'
import type { Tool, ToolContext } from './types'

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
}

export function createLaserTool(): Tool {
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

  const appendSample = (clientX: number, clientY: number, ctx: ToolContext): void => {
    const { x, y } = ctx.toBoard(clientX, clientY)
    points.push({ x, y, t: performance.now() })
  }

  return {
    id: 'laser',
    // Crosshair fits the "precise pointing" gesture better than a brush
    // preview; the trail itself is the visible indicator.
    cursor: 'crosshair',

    onPointerDown(e, ctx) {
      active = true
      appendSample(e.clientX, e.clientY, ctx)
      startFadeLoop(ctx)
    },

    onPointerMove(e, ctx) {
      if (!active) return
      // Sample every move plus any coalesced sub-events so fast gestures
      // produce a continuous trail rather than dot-to-dot jumps. Bounded
      // by the natural cull on age, so we don't need a max-sample cap.
      const coalesced = e.getCoalescedEvents?.() ?? []
      if (coalesced.length === 0) {
        appendSample(e.clientX, e.clientY, ctx)
      } else {
        for (const ce of coalesced) appendSample(ce.clientX, ce.clientY, ctx)
      }
    },

    onPointerUp(_e, _ctx) {
      active = false
      // Don't clear samples here — the RAF loop keeps fading until the
      // oldest sample times out, which is the whole point of the laser.
    },

    redraw(ctx) {
      // Live-layer only. clearLayer is the global render loop's job; we
      // re-apply the camera transform and paint the trail with per-segment
      // alpha based on the OLDER endpoint's age (segments fade away from
      // their tail end, matching how a real laser trail dissipates).
      if (points.length < 2) {
        // Even with 0 or 1 points the layer needs an applyCamera so any
        // subsequent tool-rendered overlay lines up. clearLayer + identity
        // is the global loop's pre-state; do nothing here.
        return
      }
      clearLayer(ctx.liveLayer)
      applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
      const c = ctx.liveLayer.ctx
      const now = performance.now()
      const inkColor = ctx.resolveColor(getLaserColor())
      c.save()
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.lineWidth = LASER_WIDTH_PX / ctx.camera.scale
      c.strokeStyle = inkColor
      // Soft glow gives the laser its "light" quality (vs ink). One shadow
      // setup applies to every segment we draw under this save() — cheaper
      // than re-setting per segment.
      c.shadowColor = inkColor
      c.shadowBlur = LASER_GLOW_BLUR / ctx.camera.scale
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]
        const b = points[i]
        if (!a || !b) continue
        const alpha = Math.max(0, 1 - (now - a.t) / LASER_FADE_MS)
        if (alpha <= 0) continue
        c.globalAlpha = alpha
        c.beginPath()
        c.moveTo(a.x, a.y)
        c.lineTo(b.x, b.y)
        c.stroke()
      }
      c.restore()
    },

    renderContextualMenu(host, dismiss) {
      // COLOR section — sets `laserColor` (NOT pen `color`). Same curated
      // palette as the pen tool's right-click section so the visual is
      // consistent; the active-state mark reflects the laser-specific
      // color so the user can see what's selected for this tool.
      host.appendChild(sectionLabel('Laser color'))
      const palette = paletteGrid()
      const activeColor = getLaserColor()
      for (const c of PALETTE) {
        palette.appendChild(
          swatch({
            color: c,
            active: activeColor === c,
            onClick: () => {
              setLaserColor(c)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(palette)
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
