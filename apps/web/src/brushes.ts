/**
 * Brush presets per SPEC § 3.2.
 *
 * Each preset describes the *shape* of strokes a brush produces —
 * perfect-freehand parameters, opacity, pressure curve. The brush's color
 * is composed at stroke-start time from the active color setting, not
 * stored here, so multiple presets share whatever color the user picked.
 *
 * The pen preset's parameter values were tuned during M0 / M1.5 feel
 * iterations on a real Wacom Intuos (γ=1.3, thinning 0.6, opacity 0.94,
 * etc.). The other four follow the spec's intent — marker constant-width
 * and bold; pencil thin and pressure-responsive; highlighter wide,
 * translucent, flat-capped; brush expressive with taper at both ends.
 */

import type { BrushConfig } from '@whiteboard/shared'

export type BrushId = 'pen' | 'marker' | 'pencil' | 'highlighter' | 'brush'

/** Ordered list — index = position in the keyboard 1–5 shortcut. */
export const BRUSH_IDS: readonly BrushId[] = ['pen', 'marker', 'pencil', 'highlighter', 'brush']

/** Human-friendly labels for tooltips and the eventual settings UI. */
export const BRUSH_LABELS: Readonly<Record<BrushId, string>> = {
  pen: 'Pen',
  marker: 'Marker',
  pencil: 'Pencil',
  highlighter: 'Highlighter',
  brush: 'Brush',
}

export const BRUSH_PRESETS: Readonly<Record<BrushId, Omit<BrushConfig, 'color'>>> = {
  pen: {
    size: 3.5,
    thinning: 0.6,
    smoothing: 0.72,
    streamline: 0.4,
    taperStart: 0,
    taperEnd: 0,
    capStart: true,
    capEnd: true,
    pressureGamma: 1.3,
    opacity: 0.94,
  },
  marker: {
    size: 8,
    thinning: 0.0,
    smoothing: 0.5,
    streamline: 0.4,
    taperStart: 0,
    taperEnd: 0,
    capStart: true,
    capEnd: true,
    pressureGamma: 1.5,
    opacity: 0.92,
  },
  pencil: {
    size: 2.5,
    thinning: 0.7,
    smoothing: 0.5,
    streamline: 0.55,
    taperStart: 4,
    taperEnd: 4,
    capStart: true,
    capEnd: true,
    pressureGamma: 1.4,
    opacity: 0.85,
  },
  highlighter: {
    size: 18,
    thinning: 0.0,
    smoothing: 0.3,
    streamline: 0.5,
    taperStart: 0,
    taperEnd: 0,
    capStart: false,
    capEnd: false,
    pressureGamma: 1.2,
    opacity: 0.42,
  },
  brush: {
    size: 12,
    thinning: 0.65,
    smoothing: 0.6,
    streamline: 0.65,
    taperStart: 8,
    taperEnd: 12,
    capStart: true,
    capEnd: true,
    pressureGamma: 1.5,
    opacity: 0.94,
  },
}

export function isValidBrushId(s: string): s is BrushId {
  return (BRUSH_IDS as readonly string[]).includes(s)
}
