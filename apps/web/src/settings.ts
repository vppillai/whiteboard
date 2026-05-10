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

import type { BrushConfig } from '@whiteboard/shared'
import { BRUSH_PRESETS, type BrushId, isValidBrushId } from './brushes'

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

type PresetField = keyof Omit<BrushConfig, 'color'>
const VALID_PRESET_FIELDS: readonly PresetField[] = [
  'size',
  'opacity',
  'thinning',
  'smoothing',
  'streamline',
  'taperStart',
  'taperEnd',
  'capStart',
  'capEnd',
  'pressureGamma',
]
const isValidPresetField = (k: string): k is PresetField =>
  (VALID_PRESET_FIELDS as readonly string[]).includes(k)

export interface GridConfig {
  type: GridType
  /** Board-pixel spacing between grid units. */
  spacing: number
}

export interface SettingsV1 {
  schemaVersion: 1
  color: string
  brush: BrushId
  eraserSize: EraserSize
  grid: GridConfig
  presets: Partial<Record<BrushId, Partial<Omit<BrushConfig, 'color'>>>>
  customSwatches: string[]
  recentColors: string[]
  fonts: string[]
  syncedAt?: number
  remoteId?: string
}

interface State extends SettingsV1 {
  // session-only (not persisted)
  eraserMode: EraserMode
}

const STORAGE_KEY = 'whiteboard:settings'
const VALID_GRID_TYPES: readonly GridType[] = ['dots', 'lines', 'ruled', 'none']
const VALID_SPACINGS: readonly number[] = [16, 24, 32, 48]
const RECENT_COLORS_CAP = 6

/** Persisted V1 defaults. State extends with the session-only `eraserMode`
 *  via `DEFAULTS`. Keeping these split lets `migrate(null)` return a clean
 *  SettingsV1 without leaking eraserMode into the persisted shape. */
function defaultV1(): SettingsV1 {
  return {
    schemaVersion: 1,
    color: 'ink',
    brush: 'pen',
    eraserSize: 'medium',
    grid: { type: 'dots', spacing: 24 },
    presets: {},
    customSwatches: [],
    recentColors: [],
    fonts: [],
  }
}

const DEFAULTS: State = { ...defaultV1(), eraserMode: 'wipe' }
const PERSIST_DEBOUNCE_MS = 100

function isValidGridType(s: unknown): s is GridType {
  return typeof s === 'string' && (VALID_GRID_TYPES as readonly string[]).includes(s)
}

function isValidSpacing(n: unknown): n is number {
  return typeof n === 'number' && VALID_SPACINGS.includes(n)
}

function isValidHex(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
}

function isV1(parsed: unknown): parsed is SettingsV1 {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { schemaVersion?: unknown }).schemaVersion === 1
  )
}

/** Migrate any input to a well-formed SettingsV1. Mechanical fill — never
 *  strips or transforms v0 data. Idempotent on v1 input. */
export function migrate(input: unknown): SettingsV1 {
  if (input === null || typeof input !== 'object') return defaultV1()
  const v = input as Record<string, unknown>

  const grid = (v.grid && typeof v.grid === 'object' ? v.grid : {}) as Record<string, unknown>
  const presets = (v.presets && typeof v.presets === 'object' ? v.presets : {}) as Record<
    string,
    unknown
  >

  return {
    schemaVersion: 1,
    color: typeof v.color === 'string' ? v.color : DEFAULTS.color,
    brush: typeof v.brush === 'string' && isValidBrushId(v.brush) ? v.brush : DEFAULTS.brush,
    eraserSize:
      typeof v.eraserSize === 'string' && isValidEraserSize(v.eraserSize)
        ? v.eraserSize
        : DEFAULTS.eraserSize,
    grid: {
      type: isValidGridType(grid.type) ? grid.type : DEFAULTS.grid.type,
      spacing: isValidSpacing(grid.spacing) ? grid.spacing : DEFAULTS.grid.spacing,
    },
    presets: validatePresets(presets),
    customSwatches: Array.isArray(v.customSwatches) ? v.customSwatches.filter(isValidHex) : [],
    recentColors: Array.isArray(v.recentColors)
      ? v.recentColors.filter(isValidHex).slice(0, RECENT_COLORS_CAP)
      : [],
    fonts: Array.isArray(v.fonts) ? v.fonts.filter((f) => typeof f === 'string') : [],
    syncedAt: typeof v.syncedAt === 'number' ? v.syncedAt : undefined,
    remoteId: typeof v.remoteId === 'string' ? v.remoteId : undefined,
  }
}

/** Numeric BrushConfig fields a preset override may carry. Mirror of the
 *  numeric keys in `BrushConfig` (`color` excluded; `capStart`/`capEnd` are
 *  booleans, validated separately). */
const NUMERIC_PRESET_FIELDS = [
  'size',
  'thinning',
  'smoothing',
  'streamline',
  'taperStart',
  'taperEnd',
  'pressureGamma',
  'opacity',
] as const

function validatePresets(raw: Record<string, unknown>): SettingsV1['presets'] {
  const out: SettingsV1['presets'] = {}
  for (const [key, val] of Object.entries(raw)) {
    if (!isValidBrushId(key)) continue
    if (!val || typeof val !== 'object') continue
    const validated = validateOnePreset(val as Record<string, unknown>)
    if (Object.keys(validated).length > 0) out[key] = validated
  }
  return out
}

/** Field-level validation for a single preset override. Drops unknown keys
 *  and type-mismatched values rather than letting a tampered localStorage
 *  surface NaN downstream (e.g. `size: "banana"`). */
function validateOnePreset(raw: Record<string, unknown>): Partial<Omit<BrushConfig, 'color'>> {
  const out: Partial<Omit<BrushConfig, 'color'>> = {}
  for (const k of NUMERIC_PRESET_FIELDS) {
    const v = raw[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  for (const k of ['capStart', 'capEnd'] as const) {
    const v = raw[k]
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

function cloneSettings(s: State): State {
  return JSON.parse(JSON.stringify(s)) as State
}

const state: State = load()
const listeners = new Set<() => void>()

function load(): State {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return cloneSettings(DEFAULTS)
  }
  if (!raw) return cloneSettings(DEFAULTS)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return cloneSettings(DEFAULTS)
  }

  const settings = migrate(parsed)

  // If we just migrated from v0, write back v1 so subsequent loads are clean.
  if (!isV1(parsed)) persistSettings(settings)

  // eraserMode is intentionally session-scoped — Item is a niche surgical
  // mode; persisting it across sessions traps users in Item mode after
  // they've forgotten they selected the pill. Shift gives momentary Item
  // mid-gesture; the menu pill gives session-scoped Item. Reload resets.
  return { ...settings, eraserMode: DEFAULTS.eraserMode }
}

function persistSettings(s: SettingsV1): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch (err) {
    console.warn('whiteboard/settings: failed to persist:', err)
  }
}

/** Synchronous write — strips the session-only `eraserMode` and shoves the
 *  rest into localStorage. Called from `persist` after the debounce fires
 *  AND from the `beforeunload` flush so a slider drag right before tab
 *  close doesn't lose its trailing edit. */
function persistNow(): void {
  const { eraserMode: _ignore, ...persisted } = state
  persistSettings(persisted)
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** Debounced persist. Slider drags emit one `input` event per drag step
 *  (~60 Hz); without debounce, each step triggers JSON.stringify + a
 *  synchronous localStorage.setItem — measurably noticeable on slow
 *  devices. The in-memory state is updated synchronously by setters; only
 *  the disk write lags by up to PERSIST_DEBOUNCE_MS. */
function persist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistNow()
  }, PERSIST_DEBOUNCE_MS)
}

// Flush any pending debounced write on tab close so a trailing slider edit
// doesn't get lost. `pagehide` is more reliable than `beforeunload` on
// mobile / SPA navigation (the latter doesn't always fire).
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
      persistTimer = null
      persistNow()
    }
  })
}

function emit(): void {
  for (const fn of listeners) fn()
}

export function getEffectiveBrushConfig(brushId: BrushId, color: string): BrushConfig {
  const def = BRUSH_PRESETS[brushId]
  const override = state.presets[brushId] ?? {}
  return { ...def, ...override, color }
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

export function setPresetField<K extends PresetField>(
  brushId: BrushId,
  field: K,
  value: BrushConfig[K],
): void {
  if (!isValidPresetField(field as string)) return
  const cur = state.presets[brushId] ?? {}
  ;(cur as Record<string, unknown>)[field as string] = value
  state.presets[brushId] = cur
  persist()
  emit()
}

export function clearPreset(brushId: BrushId): void {
  if (state.presets[brushId] === undefined) return
  delete state.presets[brushId]
  persist()
  emit()
}

export function resetAll(): void {
  state.presets = {}
  state.customSwatches = []
  state.recentColors = []
  state.color = DEFAULTS.color
  state.brush = DEFAULTS.brush
  state.eraserSize = DEFAULTS.eraserSize
  state.eraserMode = DEFAULTS.eraserMode
  state.grid = { ...DEFAULTS.grid }
  // theme intentionally NOT reset — see spec § 9
  persist()
  emit()
}

export function addCustomSwatch(hex: string): void {
  if (!isValidHex(hex)) return
  if (state.customSwatches.includes(hex)) return
  state.customSwatches.push(hex)
  persist()
  emit()
}

export function removeCustomSwatch(hex: string): void {
  const idx = state.customSwatches.indexOf(hex)
  if (idx === -1) return
  state.customSwatches.splice(idx, 1)
  persist()
  emit()
}

export function pushRecentColor(hex: string): void {
  if (hex === 'ink' || !isValidHex(hex)) return
  const existing = state.recentColors.indexOf(hex)
  if (existing !== -1) state.recentColors.splice(existing, 1)
  state.recentColors.unshift(hex)
  if (state.recentColors.length > RECENT_COLORS_CAP) {
    state.recentColors.length = RECENT_COLORS_CAP
  }
  persist()
  emit()
}

export function getCustomSwatches(): readonly string[] {
  return state.customSwatches
}

export function getRecentColors(): readonly string[] {
  return state.recentColors
}

/** Test-only: resets in-memory state and clears the persisted key. Also
 *  cancels any pending debounced persist so a stale write from a previous
 *  test doesn't fire after the reset and clobber the cleared key. */
export function __resetForTesting(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  Object.assign(state, cloneSettings(DEFAULTS))
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
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
