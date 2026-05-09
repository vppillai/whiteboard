/**
 * App-level settings: brush color, recent colors, grid configuration.
 *
 * Single source of truth, persisted to localStorage. Subscribers are notified
 * synchronously on change so the renderer can mark itself dirty.
 *
 * Brush color uses a small DSL: the literal token `'ink'` resolves to the
 * theme's `--ink` CSS variable at render time (so theme switches reflow
 * existing strokes); any other value is treated as a literal CSS color.
 */

export type GridType = 'dots' | 'lines' | 'ruled' | 'none'

export interface GridConfig {
  type: GridType
  /** Board-pixel spacing between grid units. */
  spacing: number
}

interface PersistedShape {
  color?: string
  recentColors?: string[]
  grid?: { type?: GridType; spacing?: number }
}

interface State {
  color: string
  recentColors: string[]
  grid: GridConfig
}

const STORAGE_KEY = 'whiteboard:settings'
const VALID_GRID_TYPES: readonly GridType[] = ['dots', 'lines', 'ruled', 'none']
const VALID_SPACINGS: readonly number[] = [16, 24, 32, 48]
const RECENT_COLORS_MAX = 6

const DEFAULTS: State = {
  color: 'ink',
  recentColors: [],
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
      recentColors: Array.isArray(parsed.recentColors)
        ? parsed.recentColors
            .filter((c): c is string => typeof c === 'string')
            .slice(0, RECENT_COLORS_MAX)
        : [],
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
  return { color: s.color, recentColors: [...s.recentColors], grid: { ...s.grid } }
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
  // Keep `ink` out of the recent-colors list — it's always available.
  if (color !== 'ink') {
    state.recentColors = [color, ...state.recentColors.filter((c) => c !== color)].slice(
      0,
      RECENT_COLORS_MAX,
    )
  }
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
