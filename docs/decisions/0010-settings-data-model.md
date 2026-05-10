# 0010. Settings data model — versioned schema, sparse preset overrides, sync-ready reserved fields

Date: 2026-05-09

## Status

Accepted. Implemented in M1.7.

## Context

M1.5 introduced the first real settings surface: brush color, grid configuration, and the configurable-grid renderer. `settings.ts` wrote a flat JSON blob to `localStorage` under the key `whiteboard:settings`. The shape was implicit — no `schemaVersion`, no migration story, no contract on what the keys meant or whether they were exhaustive.

M1.7 compounds the surface: brush preset tuning (size / opacity / pressureGamma per brush), 8 advanced `BrushConfig` fields per brush, custom color swatches, recent colors, and font reservation for the future Text tool. Three forces collide:

1. **Schema drift.** Existing `whiteboard:settings` blobs in users' localStorage carry only the M1.5 fields. Loading M1.7 code against an M1.5 blob must not silently drop the user's grid or brush-color preference, and must not crash on missing fields. Without a migration path, every new field is a possible undefined-dereference.

2. **Sync readiness.** The spec backlog (SPEC § 10) calls out cross-device settings sync as a post-v1 goal. A sync layer that touches a schema it can't version is fragile — every future field addition risks a cloud-vs-local conflict that can't be resolved without knowing which side is newer.

3. **Reset semantics.** M1.7 adds a "Reset to defaults" footer in the settings panel. Reset scope B (preferences, preset overrides, custom swatches, recent colors) must be uniform: one call, one function, no ad-hoc per-field clearing. Without a schema contract, `resetAll()` is guesswork.

The CHANGELOG M1.5 entry claimed an inline recent-colors row that "persists across reloads (max 6)." A code audit (`grep -rn "recent" apps/web/src/`) found no implementation — the feature was scoped in CHANGELOG but never landed. Only three localStorage keys existed: `whiteboard:theme`, `whiteboard:settings`, `whiteboard:view`. M1.7 implements recent colors for the first time, directly into `settings.recentColors`.

The spec for M1.7 is at `docs/superpowers/specs/2026-05-09-m1.7-settings-side-panel-design.md`.

## Decision

### Versioned schema (`SettingsV1`)

`settings.ts` is rewritten around a named type with an explicit `schemaVersion` discriminant:

```ts
import type { BrushConfig } from '@whiteboard/shared'
import type { BrushId } from './brushes'

export type GridType = 'dots' | 'lines' | 'ruled' | 'none'
export type EraserSize = 'small' | 'medium' | 'large'

export interface SettingsV1 {
  schemaVersion: 1

  // existing scalars (preserved from v0)
  color: string
  brush: BrushId
  eraserSize: EraserSize
  grid: { type: GridType; spacing: number }

  // new in v1
  presets: Partial<Record<BrushId, Partial<Omit<BrushConfig, 'color'>>>>
  customSwatches: string[]   // hex strings, e.g. '#fbcfe8'
  recentColors: string[]     // most-recent first; capped at 6
  fonts: string[]            // reserved for Text tool (M2+)

  // reserved for future sync (post-v1)
  syncedAt?: number
  remoteId?: string
}
```

The `schemaVersion: 1` literal acts as a type-level discriminant: `isV1(parsed)` is a simple `parsed?.schemaVersion === 1` check. Future versions follow the same pattern — `schemaVersion: 2` has its own interface and its own `migrateV1ToV2`.

`eraserMode` is deliberately excluded — it remains session-only. The existing rationale (persisting `'item'` mode across reloads traps users in a surgical mode they rarely want) still holds.

### Sparse preset overrides

`presets[brushId]` carries only the fields the user has changed from the SPEC default — `Partial<Omit<BrushConfig, 'color'>>` — not the full `BrushConfig`. Color is excluded from the preset because it lives in `settings.color` and is shared across brushes. The effective config for any draw operation is composed at read time:

```ts
export function getEffectiveBrushConfig(brushId: BrushId, color: string): BrushConfig {
  const def = BRUSH_PRESETS[brushId]
  const override = state.presets[brushId] ?? {}
  return { ...def, ...override, color }
}
```

Empty `presets` (the default state) produces exactly the SPEC defaults — no behavioral change for users who never open the settings panel. "Reset this preset" in the panel calls `clearPreset(brushId)`, which deletes `state.presets[brushId]` — the next stroke reverts to the SPEC value.

Existing committed `Stroke` objects are unaffected: `Stroke.brush` is a snapshot of `BrushConfig` captured at `pointerdown` (see `architecture.md` § 4). Changing a preset only affects future strokes.

### Reserved sync fields

`syncedAt?: number` and `remoteId?: string` are declared in `SettingsV1` from day one. No M1.7 code touches them. Their presence:

- prevents a future sync layer from needing a `v1 → v2` migration just to add two optional fields.
- documents intent visibly in the type — anyone reading `SettingsV1` sees "this is meant to be sync-able."
- commits to nothing about transport, auth, or conflict resolution — those decisions are deferred to the sync milestone.

### Eager migrate-on-load (Strategy A)

`load()` is the single entry point. It reads from `localStorage`, detects the schema version, and either validates the existing v1 blob or migrates v0:

```ts
function load(): SettingsV1 {
  const raw = localStorage.getItem('whiteboard:settings')
  if (!raw) return clone(DEFAULTS)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return clone(DEFAULTS)   // corrupted; reset
  }
  if (isV1(parsed)) return validate(parsed)
  // v0 (no schemaVersion): migrate
  const v1 = migrateFromV0(parsed)
  persist(v1)   // write back so subsequent loads see v1
  return v1
}
```

`migrateFromV0` only fills new fields with defaults — it never strips or transforms v0 data. Existing `color`, `brush`, `eraserSize`, and `grid` fields are carried forward exactly. This is the mechanical-fill principle: migration is additive, not destructive.

The write-back step (`persist(v1)` immediately after migration) ensures subsequent loads always find a v1 blob. There is no "v0 reader" path in the steady state.

### Primitive-vs-content split for `sidepanel.ts`

The settings panel's UI lives in `settings/panel-content.ts`, not in the panel primitive (`sidepanel.ts`). The primitive exposes:

```ts
interface SidePanelOptions {
  title: string
  content: HTMLElement  // panel takes ownership
  onDismiss?: () => void
  refocusOnClose?: HTMLElement
}
function showSidePanel(opts: SidePanelOptions): SidePanel
function dismissSidePanel(): boolean
function isSidePanelOpen(): boolean
```

This mirrors ADR 0007's lesson for tools: M1.4's thin `Tool` interface had to be extended at M1 when cursor rendering and contextual menus turned out to need per-tool ownership. `main.ts` and `toolmenu.ts` grew per-tool conditionals that had to be surgically removed. The side panel has the same structural risk — baking in the primitive-vs-content split from day one avoids the retrofit pass when M2 adds an AI-features panel or a file-browser panel.

`panel-content.ts` depends on `sidepanel.ts`; `sidepanel.ts` knows nothing about `panel-content.ts`. Future panels compose the same primitive without modifying it.

## Theme isolation

`theme.ts` owns a separate storage key (`whiteboard:theme`). This is a deliberate module boundary: `resetAll()` in `settings.ts` cannot touch `whiteboard:theme` without importing `theme.ts` and crossing module ownership lines.

The "Reset to defaults" flow (scope B) therefore preserves the user's theme. This is the right call for two reasons:

1. **No jarring flash.** Resetting settings while in dark mode would briefly show a light-mode canvas before settings re-applied — a visible flicker that violates the snappy tenet.
2. **Preserve user preference for the chrome.** Theme is environmental, not a "drawing preference." A user who has chosen dark mode expects it to survive a reset of their brush sliders and custom swatches.

The schema split — `whiteboard:settings` for drawing preferences, `whiteboard:theme` for environment — maps onto the user's mental model better than a single monolithic blob would.

## Considered alternatives

### Lazy fallback (no migration, fill undefined at callsite)

The natural first instinct: add new fields with `?? defaultValue` at every read site. No migration code. No schema version.

Rejected because it doubles the validation matrix. After every deploy, the code must handle both "old blob missing the field" and "new blob with the field" on every access. Unit tests can't cover "what is actually persisted right now" because there's no single source of truth. When the sync layer arrives, it has no basis for determining whether a missing field means "not yet set" or "deliberately cleared" — the semantics are ambiguous.

### Two-key parallel storage

Keep the existing `whiteboard:settings` key for the M1.5 fields and add a second key (`whiteboard:settings-v1-ext`) for the new M1.7 fields. Load both; merge in memory.

Rejected as overkill. The total settings blob is ~150 bytes of JSON. There is no performance argument for splitting it. The merge logic introduces a new class of bug: what does it mean when the two keys are out of sync? With a single versioned key, that question doesn't exist. All the complexity of "reading an old shape" is already handled by `migrateFromV0`; there's no benefit to sharding.

### Dense full-config override (store full `BrushConfig` per preset)

Store the entire `BrushConfig` under `presets[brushId]` rather than just the delta. Avoids the compose-at-read step.

Rejected because every preset entry would carry the full `BrushConfig` even when only one field is changed — all 11 fields replicated for a single slider tweak. When sync diffs arrive (post-v1), field-level changes would be invisible inside the full-config blob — the sync layer would see the whole preset change rather than "user moved the size slider by 2." The sparse approach keeps each `presets[brushId]` small and semantically meaningful; the compose step (`{ ...def, ...override, color }`) is a single spread with negligible cost at draw time.

## Consequences

### Easier

- **Single load path post-migration.** Once the v0 → v1 migration has written back, the code only deals with v1 shapes. No per-field guards in callers.
- **Tests cover the migration surface.** `settings.test.ts` is the first `bun test` file in the project. It covers: v0 → v1 promotion, malformed JSON (defaults), partial-v1 (missing fields), type-mismatched fields (coerced or defaulted), idempotent re-migration, hex filtering on `customSwatches`, `recentColors` cap and MRU order, `resetAll()` uniformity.
- **Future sync layer plugs in via reserved fields without schema bump.** `syncedAt` and `remoteId` are declared; the sync layer can start writing them without touching `SettingsV1`.
- **`resetAll()` is uniform.** Scope B (color, brush, eraserSize, grid, presets, customSwatches, recentColors) is wiped in one function call with a clone of `DEFAULTS`. No per-category special cases.
- **`getEffectiveBrushConfig` is the only render-time read.** Callers no longer need to know whether a preset has been overridden; they always get the composed result.

### Harder

- **More code surface.** `settings.ts` is rewritten rather than extended. `migrate()`, `validate()`, `validatePresets()`, `isV1()`, and `clone()` are new functions that all need to be correct and tested.
- **First-time test runner.** `bun test` runs for the first time in this project. The workspace bun config had to be confirmed to discover test files under `apps/web/src/`.
- **A buggy `migrate()` would surface as "all defaults."** The v0 blob is overwritten at migrate time — a migration bug that silently drops the user's preferences can't be undone from localStorage. Mitigation: explicit unit tests across all edge cases (see above). The blast radius is limited — settings are preferences, not strokes; no IDB data is touched.
- **`validatePresets()` filters to `isValidBrushId`.** A preset entry whose key is not in `BRUSH_IDS` is silently dropped on load. This prevents a preset key like `'pen-pro'` from shadowing the built-in `'pen'` if any future code introspects `state.presets` by key without going through `getEffectiveBrushConfig`. Callers that only ever call `getEffectiveBrushConfig(brushId, color)` with a known `BrushId` are safe regardless, but the filter adds defense-in-depth.

## Migration path forward

When `schemaVersion` bumps to 2, follow the same eager-migrate pattern in `load()`:

```ts
if (isV1(parsed)) return migrateV1ToV2(parsed)
```

`migrateV1ToV2` fills new fields with defaults and never strips v1 data. The write-back step is identical. The mechanical-fill principle scales linearly with the number of versions — each migration function is additive and independently testable. There is never a "skip two versions" problem because the migration chain is linear and each version's shape is an explicit TypeScript interface.

The `schemaVersion` discriminant also makes exhaustive switch possible at the type level if the migration chain grows long — a future `loadVersioned(parsed)` function can use a `switch (parsed.schemaVersion)` with a TypeScript exhaustive check to ensure no version is handled implicitly.
