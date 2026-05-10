/**
 * Pressure curve editor — SVG graph with draggable midpoint, plus a small
 * test-stroke pad. Mounted inside the M1.7 panel's Brush preset card when
 * that card is expanded for curve editing (panel-content.ts at Task 10).
 *
 * Pure helpers (graphToNorm, normToGraph, sampleCurvePolyline) are unit-
 * tested without DOM. The DOM-mounting parts are feel-tested.
 */

import type { BrushId } from '../brushes'
import { clearPresetCurve, getEffectiveBrushConfig, setPresetField } from '../settings'
import { bezierY } from '../stroke'

const GRAPH_W = 200
const GRAPH_H = 120
const HANDLE_R = 5
const SVG_NS = 'http://www.w3.org/2000/svg'

/** Convert graph-space coordinates (top-left origin, GRAPH_W × GRAPH_H) to
 *  normalized pressure-curve coordinates (0,0 = bottom-left = no pressure,
 *  1,1 = top-right = max pressure). Pure function. */
export function graphToNorm(gx: number, gy: number, w: number, h: number): [number, number] {
  const nx = clamp(gx / w, 0, 1)
  const ny = clamp(1 - gy / h, 0, 1)
  return [nx, ny]
}

/** Inverse of graphToNorm — normalized (0–1) coords to graph-space. */
export function normToGraph(nx: number, ny: number, w: number, h: number): [number, number] {
  return [nx * w, (1 - ny) * h]
}

/**
 * Sample N points along the curve in normalized (0–1) coords. If `mid` is
 * not null, sample the bezier (through-point at mid); otherwise sample the
 * γ power curve via `input ** gamma`. Pure function — unit-tested.
 */
export function sampleCurvePolyline(
  mid: readonly [number, number] | null,
  n: number,
  gamma = 1,
): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1)
    const y = mid ? bezierY(x, mid) : x ** gamma
    pts.push([x, y])
  }
  return pts
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export interface CurveEditorOptions {
  brushId: BrushId
  /** Called when the curve override changes (drag, click-create, reset).
   *  Caller uses this to update the thumbnail. */
  onChange?: () => void
}

/** Mount the curve editor (graph + handle + test pad + reset link) into
 *  `host`. Returns a cleanup function. */
export function mountCurveEditor(host: HTMLElement, opts: CurveEditorOptions): () => void {
  const { brushId, onChange } = opts
  host.classList.add('curve-editor')

  const svg = createSvg(GRAPH_W, GRAPH_H)
  host.appendChild(svg)

  // Diagonal reference line (identity / "no curve").
  svg.appendChild(
    svgEl('line', {
      x1: '0',
      y1: String(GRAPH_H),
      x2: String(GRAPH_W),
      y2: '0',
      stroke: '#d4d4d8',
      'stroke-dasharray': '3 3',
      'stroke-width': '0.5',
    }),
  )

  // Light grid at 0.25 / 0.5 / 0.75.
  for (const f of [0.25, 0.5, 0.75]) {
    svg.appendChild(
      svgEl('line', {
        x1: String(f * GRAPH_W),
        y1: '0',
        x2: String(f * GRAPH_W),
        y2: String(GRAPH_H),
        stroke: '#f4f4f5',
        'stroke-width': '0.5',
      }),
    )
    svg.appendChild(
      svgEl('line', {
        x1: '0',
        y1: String((1 - f) * GRAPH_H),
        x2: String(GRAPH_W),
        y2: String((1 - f) * GRAPH_H),
        stroke: '#f4f4f5',
        'stroke-width': '0.5',
      }),
    )
  }

  // Curve path.
  const curvePath = svgEl('path', {
    stroke: 'var(--accent, #3b82f6)',
    'stroke-width': '1.5',
    fill: 'none',
    'stroke-linejoin': 'round',
  })
  svg.appendChild(curvePath)

  // Draggable midpoint handle (only visible when override exists).
  const handle = svgEl('circle', {
    r: String(HANDLE_R),
    fill: 'var(--accent, #3b82f6)',
    stroke: 'white',
    'stroke-width': '1.5',
    cursor: 'grab',
  })
  ;(handle as unknown as HTMLElement).style.display = 'none'
  svg.appendChild(handle)

  // Reset link.
  const resetLink = document.createElement('button')
  resetLink.type = 'button'
  resetLink.className = 'curve-reset'
  resetLink.textContent = `Reset ${brushId} curve`
  resetLink.addEventListener('click', () => {
    clearPresetCurve(brushId)
    redraw()
    onChange?.()
  })
  host.appendChild(resetLink)

  function redraw(): void {
    const eff = getEffectiveBrushConfig(brushId, '#000000')
    const mid = eff.pressureCurve?.mid ?? null
    const gamma = eff.pressureGamma ?? 1
    const pts = sampleCurvePolyline(mid, 32, gamma)
    const d = pts
      .map(([x, y], i) => {
        const [gx, gy] = normToGraph(x, y, GRAPH_W, GRAPH_H)
        return `${i === 0 ? 'M' : 'L'} ${gx.toFixed(2)} ${gy.toFixed(2)}`
      })
      .join(' ')
    curvePath.setAttribute('d', d)

    if (mid) {
      const [hx, hy] = normToGraph(mid[0], mid[1], GRAPH_W, GRAPH_H)
      handle.setAttribute('cx', String(hx))
      handle.setAttribute('cy', String(hy))
      ;(handle as unknown as HTMLElement).style.display = ''
    } else {
      ;(handle as unknown as HTMLElement).style.display = 'none'
    }
  }

  // Click-to-create / drag-to-adjust on the graph.
  svg.addEventListener('pointerdown', (e) => {
    const rect = svg.getBoundingClientRect()
    const gx = e.clientX - rect.left
    const gy = e.clientY - rect.top
    const [nx, ny] = graphToNorm(gx, gy, GRAPH_W, GRAPH_H)
    setPresetField(brushId, 'pressureCurve', { mid: [nx, ny] })
    redraw()
    onChange?.()
    startDrag()
  })

  function startDrag(): void {
    const rect = svg.getBoundingClientRect()
    const move = (e: PointerEvent): void => {
      const gx = e.clientX - rect.left
      const gy = e.clientY - rect.top
      const [nx, ny] = graphToNorm(gx, gy, GRAPH_W, GRAPH_H)
      setPresetField(brushId, 'pressureCurve', { mid: [nx, ny] })
      redraw()
      onChange?.()
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  redraw()

  // Test-stroke pad — simplified line-width modulation. Full perfect-freehand
  // fidelity is an out-of-scope follow-up per spec § 9; this is enough to
  // communicate the curve effect during feel-testing.
  const pad = document.createElement('canvas')
  pad.width = 240
  pad.height = 160
  pad.className = 'curve-test-pad'
  pad.style.cssText = 'width: 120px; height: 80px; touch-action: none;'
  host.appendChild(pad)
  attachTestPad(pad, brushId)

  return () => {
    host.classList.remove('curve-editor')
    host.replaceChildren()
  }
}

function attachTestPad(canvas: HTMLCanvasElement, brushId: BrushId): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  let drawing = false
  let lastX = 0
  let lastY = 0

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true
    canvas.setPointerCapture(e.pointerId)
    const rect = canvas.getBoundingClientRect()
    lastX = (e.clientX - rect.left) * (canvas.width / rect.width)
    lastY = (e.clientY - rect.top) * (canvas.height / rect.height)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  })

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)
    const p = e.pressure || 0.5
    const eff = getEffectiveBrushConfig(brushId, '#000000')
    const effective = eff.pressureCurve ? bezierY(p, eff.pressureCurve.mid) : p ** eff.pressureGamma
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1 + effective * 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(lastX, lastY)
    ctx.lineTo(x, y)
    ctx.stroke()
    lastX = x
    lastY = y
  })

  canvas.addEventListener('pointerup', () => {
    drawing = false
  })
  canvas.addEventListener('pointercancel', () => {
    drawing = false
  })
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

function createSvg(w: number, h: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('width', String(w))
  svg.setAttribute('height', String(h))
  svg.setAttribute('class', 'curve-graph')
  return svg
}

/**
 * Render a thumbnail (~30 × 18 px) of the brush's current curve. Used by
 * panel-content.ts to flag has-override at a glance. The thumbnail is the
 * override-presence indicator (γ-shape vs bent + accent border).
 */
export function renderCurveThumbnail(brushId: BrushId): SVGSVGElement {
  const W = 30
  const H = 18
  const svg = createSvg(W, H)
  svg.setAttribute('class', 'curve-thumbnail')
  const eff = getEffectiveBrushConfig(brushId, '#000000')
  const mid = eff.pressureCurve?.mid ?? null
  const gamma = eff.pressureGamma ?? 1
  const pts = sampleCurvePolyline(mid, 16, gamma)
  const d = pts
    .map(([x, y], i) => {
      const gx = x * W
      const gy = (1 - y) * H
      return `${i === 0 ? 'M' : 'L'} ${gx.toFixed(2)} ${gy.toFixed(2)}`
    })
    .join(' ')
  const path = svgEl('path', {
    stroke: 'var(--accent, #3b82f6)',
    'stroke-width': '1',
    fill: 'none',
  })
  path.setAttribute('d', d)
  svg.appendChild(path)
  if (mid) {
    svg.classList.add('has-override')
  }
  return svg
}
