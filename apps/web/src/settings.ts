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

export interface GridConfig {
  type: GridType
  /** Board-pixel spacing between grid units. */
  spacing: number
}

interface PersistedShape {
  color?: string
  brush?: string
  grid?: { type?: GridType; spacing?: number }
}

interface State {
  color: string
  brush: BrushId
  grid: GridConfig
}

const STORAGE_KEY = 'whiteboard:settings'
const VALID_GRID_TYPES: readonly GridType[] = ['dots', 'lines', 'ruled', 'none']
const VALID_SPACINGS: readonly number[] = [16, 24, 32, 48]

const DEFAULTS: State = {
  color: 'ink',
  brush: 'pen',
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
  return { color: s.color, brush: s.brush, grid: { ...s.grid } }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
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
