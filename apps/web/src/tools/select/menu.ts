/**
 * Contextual-menu DOM builders for the Select tool — the per-kind menu
 * content shown on right-click when a single shape / text is selected.
 * Extracted from select.ts: these are pure DOM construction over a live
 * object reference, with the tool's mutable internals (in-flight drag
 * commit, persistence, op push) injected through a small explicit deps
 * object. The Select tool's `renderContextualMenu` method stays in
 * select.ts as the dispatcher that resolves the selection to a live
 * object and picks the builder.
 *
 * See ADR 0007 for the contextual-menu surface and ADR 0014 for the
 * selection union these menus hang off.
 */

import type { ShapeObject, TextFontFamily, TextObject } from '@whiteboard/shared'
import { buildFillOpacitySlider } from '../../menu-fillopacity'
import { iconFillOutline, iconFillSolid, iconStrokeWidth } from '../../menu-icons'
import { pill, pillRow, sectionLabel, separator } from '../../menu-ui'
import type { Op } from '../../ops'
import { getShapeFillOpacity } from '../../settings'
import { buildSwatchPalette } from '../../swatchpalette'
import { resizeToFit } from '../../textgeom'

/** Tool internals the shape menu needs. Kept minimal so the menu stays
 *  a pure DOM builder — everything stateful happens through these. */
export interface ShapeContextualMenuDeps {
  /** Commit any in-flight drag BEFORE snapshotting an edit's `before`
   *  payload — without this, picking a style while a drag is mid-flight
   *  would emit two undo ops for what felt like one gesture. Must be
   *  safe to call when no drag is active. */
  commitActiveDrag: () => void
  saveShape: (s: ShapeObject) => void
  pushOp: (op: Op) => void
  markCommittedDirty: () => void
}

/** Build the contextual menu for a shape selection (color / stroke
 *  width / fill toggle). Mirrors the Shape tool's own menu so style
 *  edits work in either mode. Each change emits an `edit-shape` op
 *  so undo correctly restores the previous style. */
export function renderShapeContextualMenu(
  host: HTMLElement,
  sh: ShapeObject,
  deps: ShapeContextualMenuDeps,
  dismiss: () => void,
  rebuild?: () => void,
  anchor?: { x: number; y: number },
): void {
  type EditPayload = {
    color: string
    strokeWidth: number
    fill: string | undefined
    fillOpacity: number | undefined
  }
  const snapshotEdit = (s: ShapeObject): EditPayload => ({
    color: s.color,
    strokeWidth: s.strokeWidth,
    fill: s.fill,
    fillOpacity: s.fillOpacity,
  })
  const applyEdit = (mutate: (s: ShapeObject) => void): void => {
    deps.commitActiveDrag()
    const before = snapshotEdit(sh)
    mutate(sh)
    deps.saveShape(sh)
    const after = snapshotEdit(sh)
    deps.pushOp({ kind: 'edit-shape', shapeId: sh.id, before, after })
    deps.markCommittedDirty()
  }

  // Color first (per v1.4 brief — "shapes below swatch"). Shared
  // palette helper (curated + custom + "+") matches the standalone
  // Color picker and the Shape tool's menu — adding a custom swatch
  // here is reflected immediately via rebuild.
  host.appendChild(sectionLabel('Color'))
  host.appendChild(
    buildSwatchPalette({
      active: sh.color,
      onPick: (c) => {
        applyEdit((s) => {
          s.color = c
          // If fill was on, keep it synced to the new stroke color.
          if (s.fill) s.fill = c
        })
        dismiss()
      },
      addAt: anchor ?? { x: 0, y: 0 },
      onPaletteChanged: () => rebuild?.(),
    }),
  )

  host.appendChild(separator())

  // Stroke width — icon = line preview at the corresponding thickness.
  host.appendChild(sectionLabel('Stroke width'))
  const widthRow = pillRow()
  for (const w of [1, 2, 4, 8] as const) {
    widthRow.appendChild(
      pill({
        label: `${w}px`,
        icon: iconStrokeWidth(w),
        active: sh.strokeWidth === w,
        onClick: () => {
          applyEdit((s) => {
            s.strokeWidth = w
          })
          dismiss()
        },
      }),
    )
  }
  host.appendChild(widthRow)

  host.appendChild(separator())

  // Fill toggle (icons: empty rect / filled rect).
  // Lines / arrows don't visually carry fill — disable both the
  // toggle and the opacity slider for those kinds so the user
  // sees the controls exist but they don't fire confusing ops on
  // unfillable shapes.
  const supportsFill = sh.shape !== 'line' && sh.shape !== 'arrow'
  host.appendChild(sectionLabel('Fill'))
  const fillRow = pillRow()
  const fillOn = !!sh.fill
  fillRow.appendChild(
    pill({
      label: 'Outline only',
      icon: iconFillOutline(),
      active: !fillOn,
      disabled: !supportsFill,
      onClick: supportsFill
        ? () => {
            applyEdit((s) => {
              s.fill = undefined
            })
            dismiss()
          }
        : undefined,
    }),
  )
  fillRow.appendChild(
    pill({
      label: 'Filled',
      icon: iconFillSolid(),
      active: fillOn,
      disabled: !supportsFill,
      onClick: supportsFill
        ? () => {
            applyEdit((s) => {
              s.fill = s.color
              // Newly-filled shape gets the sticky opacity if it didn't
              // already carry one — so toggling Outline→Filled inherits
              // the current default rather than the legacy 0.25 constant.
              if (s.fillOpacity === undefined) s.fillOpacity = getShapeFillOpacity()
            })
            dismiss()
          }
        : undefined,
    }),
  )
  host.appendChild(fillRow)

  // Fill opacity slider — uses the shared `buildFillOpacitySlider`
  // helper so the widget visual matches the Shape tool's menu.
  // Live preview during `input` (mutates the shape + saves +
  // marks dirty so the canvas re-renders). On `change` (pointerup
  // / keyboard release) the helper supplies the scrub-start value
  // so we emit exactly ONE edit-shape op per drag with the correct
  // pre-scrub `before` payload.
  host.appendChild(sectionLabel('Fill opacity'))
  host.appendChild(
    buildFillOpacitySlider({
      get: () => sh.fillOpacity ?? getShapeFillOpacity(),
      disabled: !supportsFill || !fillOn,
      onPreview: (v) => {
        sh.fillOpacity = v
        deps.saveShape(sh)
        deps.markCommittedDirty()
      },
      onCommit: (v, scrubStart) => {
        if (scrubStart === null || v === scrubStart) return
        const before: EditPayload = {
          color: sh.color,
          strokeWidth: sh.strokeWidth,
          fill: sh.fill,
          fillOpacity: scrubStart,
        }
        const after: EditPayload = {
          color: sh.color,
          strokeWidth: sh.strokeWidth,
          fill: sh.fill,
          fillOpacity: v,
        }
        deps.pushOp({ kind: 'edit-shape', shapeId: sh.id, before, after })
      },
    }),
  )
}

/** Tool internals the text menu needs. Same shape as the shape menu's
 *  deps, with the text persistence callback instead. */
export interface TextContextualMenuDeps {
  /** See ShapeContextualMenuDeps.commitActiveDrag. */
  commitActiveDrag: () => void
  saveText: (t: TextObject) => void
  pushOp: (op: Op) => void
  markCommittedDirty: () => void
}

/** Build the contextual menu for a text selection — the rich Color /
 *  Font / Size / B / I / U menu. Each change emits an `edit-text` op
 *  (with the rect re-fitted to the new font metrics) so undo restores
 *  the previous styling. */
export function renderTextContextualMenu(
  host: HTMLElement,
  t: TextObject,
  deps: TextContextualMenuDeps,
  dismiss: () => void,
  rebuild?: () => void,
  anchor?: { x: number; y: number },
): void {
  const applyEdit = (mutate: (text: TextObject) => void): void => {
    // Commit any in-flight drag BEFORE snapshotting `before` — without
    // this, picking a color while a rotation drag is mid-flight would
    // emit two undo ops for what felt like one gesture (the rotation
    // op on drag-release + this edit op now). Safe to call when no
    // drag is active (commitActiveDrag no-ops on null drag).
    deps.commitActiveDrag()
    const before = {
      content: t.content,
      font: { ...t.font },
      color: t.color,
      wrapWidth: t.wrapWidth,
    }
    mutate(t)
    // Re-fit the rect to any font-affecting changes so the rendered
    // bbox stays correct.
    const fitted = resizeToFit(t)
    t.transform = fitted.transform
    deps.saveText(t)
    const after = {
      content: t.content,
      font: { ...t.font },
      color: t.color,
      wrapWidth: t.wrapWidth,
    }
    deps.pushOp({ kind: 'edit-text', textId: t.id, before, after })
    deps.markCommittedDirty()
  }

  // COLOR — shared palette (curated + custom + "+").
  host.appendChild(sectionLabel('Color'))
  host.appendChild(
    buildSwatchPalette({
      active: t.color,
      onPick: (c) => {
        applyEdit((x) => {
          x.color = c
        })
        dismiss()
      },
      addAt: anchor ?? { x: 0, y: 0 },
      onPaletteChanged: () => rebuild?.(),
    }),
  )

  // FONT
  host.appendChild(separator())
  host.appendChild(sectionLabel('Font'))
  const fontRow = pillRow()
  const families: { id: TextFontFamily; label: string }[] = [
    { id: 'mono', label: 'Mono' },
    { id: 'sans', label: 'Sans' },
    { id: 'serif', label: 'Serif' },
  ]
  for (const f of families) {
    fontRow.appendChild(
      pill({
        label: f.label,
        active: t.font.family === f.id,
        onClick: () => {
          applyEdit((x) => {
            x.font = { ...x.font, family: f.id }
          })
          dismiss()
        },
      }),
    )
  }
  host.appendChild(fontRow)

  // SIZE
  host.appendChild(separator())
  host.appendChild(sectionLabel('Size'))
  const sizeRow = pillRow()
  for (const s of [12, 14, 18, 24, 36]) {
    sizeRow.appendChild(
      pill({
        label: String(s),
        active: t.font.size === s,
        onClick: () => {
          applyEdit((x) => {
            x.font = { ...x.font, size: s }
          })
          dismiss()
        },
      }),
    )
  }
  host.appendChild(sizeRow)

  // STYLE (B / I / U)
  host.appendChild(separator())
  host.appendChild(sectionLabel('Style'))
  const styleRow = pillRow()
  styleRow.appendChild(
    pill({
      label: 'B',
      active: t.font.bold,
      onClick: () => {
        applyEdit((x) => {
          x.font = { ...x.font, bold: !x.font.bold }
        })
        dismiss()
      },
    }),
  )
  styleRow.appendChild(
    pill({
      label: 'I',
      active: t.font.italic,
      onClick: () => {
        applyEdit((x) => {
          x.font = { ...x.font, italic: !x.font.italic }
        })
        dismiss()
      },
    }),
  )
  styleRow.appendChild(
    pill({
      label: 'U',
      active: t.font.underline,
      onClick: () => {
        applyEdit((x) => {
          x.font = { ...x.font, underline: !x.font.underline }
        })
        dismiss()
      },
    }),
  )
  host.appendChild(styleRow)
}
