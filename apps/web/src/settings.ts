/**
 * App-level settings: active brush, brush color, grid configuration.
 *
 * Single source of truth, persisted to localStorage. Subscribers are notified
 * synchronously on change so the renderer can mark itself dirty.
 *
 * Brush color uses a small DSL: the literal token `'ink'` resolves to the
 * theme's `--ink` CSS variable at render time (so theme switches reflow
 * existing strokes); any other value is treated as a literal CSS color.
 */

import { type BrushId, isValidBrushId } from './brushes'

export type GridType = 'dots' | 'lines' | 'ruled' | 'none'
export type EraserSize = 'small' | 'medium' | 'large'
export type EraserMode = 'wipe' | 'item'

/** Eraser hit radii (board-space pixels) keyed on user-facing size label. */
export const ERASER_RADII: Readonly<Record<EraserSize, number>> = {
  small: 6,
  medium: 12,
  large: 24,
}

const ERASER_SIZES: readonly EraserSize[] = ['small', 'medium', 'large']
const isValidEraserSize = (s: string): s is EraserSize =>
  (ERASER_SIZES as readonly string[]).includes(s)

export interface GridConfig {
  type: GridType
  /** Board-pixel spacing between grid units. */
  spacing: number
}

interface PersistedShape {
  color?: string
  brush?: string
  eraserSize?: string
  grid?: { type?: GridType; spacing?: number }
  // eraserMode is intentionally NOT persisted — see load() / persist().
}

interface State {
  color: string
  brush: BrushId
  eraserSize: EraserSize
  eraserMode: EraserMode
  grid: GridConfig
}

const STORAGE_KEY = 'whiteboard:settings'
const VALID_GRID_TYPES: readonly GridType[] = ['dots', 'lines', 'ruled', 'none']
const VALID_SPACINGS: readonly number[] = [16, 24, 32, 48]

const DEFAULTS: State = {
  color: 'ink',
  brush: 'pen',
  eraserSize: 'medium',
  eraserMode: 'wipe',
  grid: { type: 'dots', spacing: 24 },
}

const state: State = load()
const listeners = new Set<() => void>()

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return clone(DEFAULTS)
    const parsed = JSON.parse(raw) as PersistedShape
    return {
      color: typeof parsed.color === 'string' ? parsed.color : DEFAULTS.color,
      brush:
        typeof parsed.brush === 'string' && isValidBrushId(parsed.brush)
          ? parsed.brush
          : DEFAULTS.brush,
      eraserSize:
        typeof parsed.eraserSize === 'string' && isValidEraserSize(parsed.eraserSize)
          ? parsed.eraserSize
          : DEFAULTS.eraserSize,
      // eraserMode is intentionally session-scoped — Item is a niche surgical
      // mode; persisting it across sessions traps users in Item mode after
      // they've forgotten they selected the pill. Shift gives momentary Item
      // mid-gesture; the menu pill gives session-scoped Item. Reload resets.
      eraserMode: DEFAULTS.eraserMode,
      grid: {
        type:
          parsed.grid?.type && VALID_GRID_TYPES.includes(parsed.grid.type)
            ? parsed.grid.type
            : DEFAULTS.grid.type,
        spacing:
          typeof parsed.grid?.spacing === 'number' && VALID_SPACINGS.includes(parsed.grid.spacing)
            ? parsed.grid.spacing
            : DEFAULTS.grid.spacing,
      },
    }
  } catch {
    return clone(DEFAULTS)
  }
}

function clone(s: State): State {
  return {
    color: s.color,
    brush: s.brush,
    eraserSize: s.eraserSize,
    eraserMode: s.eraserMode,
    grid: { ...s.grid },
  }
}

function persist(): void {
  try {
    // eraserMode is intentionally excluded — see load().
    const { color, brush, eraserSize, grid } = state
    const payload: PersistedShape = { color, brush, eraserSize, grid }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (err) {
    console.warn('whiteboard/settings: failed to persist:', err)
  }
}

function emit(): void {
  for (const fn of listeners) fn()
}

export function getSettings(): Readonly<State> {
  return state
}

export function getColor(): string {
  return state.color
}

export function setColor(color: string): void {
  if (state.color === color) return
  state.color = color
  persist()
  emit()
}

export function getBrushId(): BrushId {
  return state.brush
}

export function setBrushId(brush: BrushId): void {
  if (state.brush === brush) return
  state.brush = brush
  persist()
  emit()
}

export function getEraserSize(): EraserSize {
  return state.eraserSize
}

export function setEraserSize(size: EraserSize): void {
  if (state.eraserSize === size) return
  state.eraserSize = size
  persist()
  emit()
}

export function getEraserMode(): EraserMode {
  return state.eraserMode
}

export function setEraserMode(mode: EraserMode): void {
  if (state.eraserMode === mode) return
  state.eraserMode = mode
  persist()
  emit()
}

/**
 * Single-shot setter used by the tool menu's "Small / Medium / Large / Item"
 * pills. Picking a size implies wipe mode; picking Item leaves the size at
 * its previous value (which doesn't matter for item mode).
 */
export function setEraserConfig(config: { mode: EraserMode; size?: EraserSize }): void {
  let changed = false
  if (state.eraserMode !== config.mode) {
    state.eraserMode = config.mode
    changed = true
  }
  if (config.size !== undefined && state.eraserSize !== config.size) {
    state.eraserSize = config.size
    changed = true
  }
  if (changed) {
    persist()
    emit()
  }
}

export function getGrid(): Readonly<GridConfig> {
  return state.grid
}

export function setGridType(type: GridType): void {
  if (state.grid.type === type) return
  state.grid.type = type
  persist()
  emit()
}

export function setGridSpacing(spacing: number): void {
  if (state.grid.spacing === spacing) return
  state.grid.spacing = spacing
  persist()
  emit()
}

export function onChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const VALID_SPACING_VALUES = VALID_SPACINGS
export const VALID_GRID_TYPE_VALUES = VALID_GRID_TYPES
