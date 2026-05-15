/**
 * Right-click menu icon library. Every icon is a factory that returns
 * a freshly-built SVGElement so callers can drop one into a button
 * without `innerHTML` (which would invite XSS for any path that ever
 * touches user content). The SVGs are inline, stroke-based, sized in
 * a 24×24 viewBox; CSS controls the rendered size + color via
 * `currentColor`. Icons inherit color from their host pill, so the
 * accent / active / disabled states light up correctly without per-
 * icon styling.
 *
 * Icon design notes:
 *   - Stroke-only (fill="none") so the active-state inversion (white
 *     pill on dark background) reads correctly.
 *   - 24×24 viewBox keeps the math simple; CSS scales them down.
 *   - Round caps + joins look soft enough to fit alongside the
 *     stroke-based shape tool's own visual language.
 *
 * Adding a new icon: add a factory function `iconFoo(): SVGElement`
 * and export it. The factory MUST build via `createElementNS` —
 * never set `innerHTML`. Repeated icon factories are cheap (cloning
 * an existing template would be marginally faster, but right-click
 * menu builds are infrequent enough that legibility wins).
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

interface SvgAttrs {
  [key: string]: string | number
}

/** Build an SVG element with attributes. Tiny shim so factories
 *  don't repeat the namespace + setAttribute boilerplate. */
function svgEl(tag: string, attrs: SvgAttrs = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v))
  }
  return el
}

/** Build the icon container `<svg>` and attach children. Common
 *  attributes (viewBox, stroke, fill="none") are baked in here so
 *  each factory stays focused on its glyph. */
function makeSvg(...children: SVGElement[]): SVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.7,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })
  for (const c of children) svg.appendChild(c)
  return svg
}

// ── Tool icons ────────────────────────────────────────────────────────────

/** Draw — pencil sketching a wavy stroke. The pencil is rendered as a
 *  thin rotated rectangle with a clear tip-and-ferrule silhouette
 *  (sharpened cone + collar + body). The wavy line under the tip
 *  reads unmistakably as "this tool draws," distinct from the Shape
 *  tool's static circle+square or the Eraser's tilted block.
 *  v1.4 second redesign per user feedback ("draw icon needs improvement"). */
export function iconPen(): SVGElement {
  // Pencil body — long diagonal rectangle running upper-right to
  // lower-left, ending in a sharpened triangle tip near (4, 17).
  // Built from a single closed path so the body reads as one piece.
  const body = svgEl('path', {
    d: 'M 17 4 L 20 7 L 9 18 L 6 18 L 6 15 Z',
    fill: 'currentColor',
    'fill-opacity': 0.18,
  })
  const bodyOutline = svgEl('path', {
    d: 'M 17 4 L 20 7 L 9 18 L 6 18 L 6 15 Z',
  })
  // Collar / ferrule cross-band between the wood tip and the painted
  // body — what distinguishes a pencil silhouette from a generic stick.
  const collar = svgEl('path', { d: 'M 14 7 L 17 10' })
  // Wavy stroke trail starting at the pencil tip — three small curves
  // suggesting freshly drawn line work.
  const trail = svgEl('path', {
    d: 'M 5 19 Q 7 21, 9 19 T 13 19 T 17 19',
  })
  return makeSvg(body, bodyOutline, collar, trail)
}

/** Text — a capital T. */
export function iconText(): SVGElement {
  return makeSvg(svgEl('path', { d: 'M 5 6 L 19 6 M 12 6 L 12 19' }))
}

/** Generic Shape (for the Tool row pill — distinct from sub-mode picks
 *  inside the Shape tool's own contextual menu). A square overlapping
 *  a circle reads as "multiple shapes." */
export function iconShape(): SVGElement {
  return makeSvg(
    svgEl('rect', { x: 4, y: 4, width: 10, height: 10, rx: 1 }),
    svgEl('circle', { cx: 16, cy: 16, r: 5 }),
  )
}

/** Eraser — minimal flat two-tone block. A clean tilted body with a
 *  diagonal split reads quickly at small sizes while staying distinct
 *  from the pen icon. The short chips under the edge suggest erased
 *  marks without adding visual clutter. */
export function iconEraser(): SVGElement {
  // Main body: clean block-eraser silhouette, slightly tilted.
  const body = svgEl('path', {
    d: 'M 5 8 L 18 6 L 20 14 L 7 16 Z',
    fill: 'currentColor',
    'fill-opacity': 0.2,
  })
  const bodyOutline = svgEl('path', {
    d: 'M 5 8 L 18 6 L 20 14 L 7 16 Z',
  })
  // Diagonal seam between sleeve and rubber face.
  const seam = svgEl('path', { d: 'M 10 7.2 L 12 15.1' })
  // Subtle erase chips.
  const chips = svgEl('path', {
    d: 'M 6 19 L 7.8 18.7 M 10 18.3 L 11.8 18 M 14 17.6 L 15.8 17.3',
  })
  return makeSvg(body, bodyOutline, seam, chips)
}

/** Select — arrow cursor. */
export function iconSelect(): SVGElement {
  return makeSvg(
    svgEl('path', {
      d: 'M 5 3 L 5 19 L 9 15 L 12 21 L 14 20 L 11 14 L 17 14 Z',
    }),
  )
}

/** Laser — a dot with a halo. */
export function iconLaser(): SVGElement {
  return makeSvg(
    svgEl('circle', { cx: 12, cy: 12, r: 2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 12, cy: 12, r: 6 }),
    svgEl('path', { d: 'M 12 2 L 12 5' }),
    svgEl('path', { d: 'M 12 19 L 12 22' }),
    svgEl('path', { d: 'M 2 12 L 5 12' }),
    svgEl('path', { d: 'M 19 12 L 22 12' }),
  )
}

// ── Shape sub-mode icons ──────────────────────────────────────────────────

export function iconShapeRect(): SVGElement {
  return makeSvg(svgEl('rect', { x: 4, y: 6, width: 16, height: 12, rx: 1 }))
}

export function iconShapeEllipse(): SVGElement {
  return makeSvg(svgEl('ellipse', { cx: 12, cy: 12, rx: 8, ry: 6 }))
}

export function iconShapeLine(): SVGElement {
  return makeSvg(svgEl('path', { d: 'M 4 20 L 20 4' }))
}

export function iconShapeArrow(): SVGElement {
  return makeSvg(
    svgEl('path', { d: 'M 4 20 L 20 4' }),
    svgEl('path', { d: 'M 12 4 L 20 4 L 20 12' }),
  )
}

// ── Shape style icons ─────────────────────────────────────────────────────

/** Outline-only rect — for the "Outline only" fill toggle option. */
export function iconFillOutline(): SVGElement {
  return makeSvg(svgEl('rect', { x: 4, y: 6, width: 16, height: 12, rx: 1 }))
}

/** Filled rect — for the "Filled" toggle. Uses currentColor with a
 *  translucent fill plus a solid stroke, matching the renderer's
 *  FILL_ALPHA convention so the icon reads as "filled shape." */
export function iconFillSolid(): SVGElement {
  const rect = svgEl('rect', {
    x: 4,
    y: 6,
    width: 16,
    height: 12,
    rx: 1,
    fill: 'currentColor',
    'fill-opacity': 0.35,
  })
  return makeSvg(rect)
}

/** Stroke-width visualization — a horizontal line at the requested
 *  pixel thickness. Caller passes the desired stroke-width (the same
 *  number that appears in the shape's `strokeWidth`). The icon scales
 *  visually with the value so the pill row reads as a ladder. */
export function iconStrokeWidth(widthPx: number): SVGElement {
  const line = svgEl('path', {
    d: 'M 3 12 L 21 12',
    'stroke-width': Math.max(1, Math.min(widthPx, 8)),
  })
  return makeSvg(line)
}

// ── View / Export / Settings / Clear row icons ────────────────────────────

/** Reset zoom — circular arrow back to 1x. */
export function iconResetZoom(): SVGElement {
  return makeSvg(
    svgEl('path', { d: 'M 4 12 A 8 8 0 1 1 12 20' }),
    svgEl('path', { d: 'M 4 6 L 4 12 L 10 12' }),
  )
}

/** Fit to view — four corner brackets fitting around a central area. */
export function iconFitView(): SVGElement {
  return makeSvg(
    svgEl('path', { d: 'M 4 8 L 4 4 L 8 4' }),
    svgEl('path', { d: 'M 16 4 L 20 4 L 20 8' }),
    svgEl('path', { d: 'M 20 16 L 20 20 L 16 20' }),
    svgEl('path', { d: 'M 8 20 L 4 20 L 4 16' }),
  )
}

/** Grid options — dot grid suggestion. */
export function iconGrid(): SVGElement {
  return makeSvg(
    svgEl('circle', { cx: 6, cy: 6, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 12, cy: 6, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 18, cy: 6, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 6, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 12, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 18, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 6, cy: 18, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 12, cy: 18, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    svgEl('circle', { cx: 18, cy: 18, r: 1.2, fill: 'currentColor', stroke: 'none' }),
  )
}

/** Export — page with arrow down. */
export function iconExport(): SVGElement {
  return makeSvg(
    svgEl('path', { d: 'M 6 3 L 14 3 L 18 7 L 18 21 L 6 21 Z' }),
    svgEl('path', { d: 'M 14 3 L 14 7 L 18 7' }),
    svgEl('path', { d: 'M 12 11 L 12 17' }),
    svgEl('path', { d: 'M 9 14 L 12 17 L 15 14' }),
  )
}

/** Settings — gear. Simplified 6-tooth gear that reads at small sizes. */
export function iconSettings(): SVGElement {
  return makeSvg(
    svgEl('circle', { cx: 12, cy: 12, r: 3 }),
    svgEl('path', {
      d:
        'M 12 2 L 12 5 ' +
        'M 12 19 L 12 22 ' +
        'M 2 12 L 5 12 ' +
        'M 19 12 L 22 12 ' +
        'M 5 5 L 7 7 ' +
        'M 17 17 L 19 19 ' +
        'M 19 5 L 17 7 ' +
        'M 7 17 L 5 19',
    }),
  )
}

/** Clear board — trash can. */
export function iconClear(): SVGElement {
  return makeSvg(
    svgEl('path', { d: 'M 4 7 L 20 7' }),
    svgEl('path', { d: 'M 9 7 L 9 4 L 15 4 L 15 7' }),
    svgEl('path', { d: 'M 6 7 L 7 20 L 17 20 L 18 7' }),
    svgEl('path', { d: 'M 10 11 L 10 17' }),
    svgEl('path', { d: 'M 14 11 L 14 17' }),
  )
}
