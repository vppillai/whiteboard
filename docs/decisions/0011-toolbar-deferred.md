# 0011. Toolbar UI — deferred (M2 scope reduction)

Date: 2026-05-10

## Status

Accepted at M2 close. Supersedes the SPEC § 4.2 floating-toolbar commitment.

## Context

The original SPEC committed to a floating, dockable, draggable toolbar in § 4.2 — pen presets always visible, recent colors inline, long-press for preset config. M2 was originally scoped around shipping that toolbar.

By the time M2 brainstorming opened (post-M1.7), the discoverability and one-click surfaces a toolbar would have served had been built into adjacent surfaces:

- **Right-click menu** (M1.5 → M1) — universal contextual surface; tools, brushes, colors, eraser modes, view actions, settings, and now (M2) export. Per-tool sections own themselves (ADR 0007).
- **Color picker popover** (M1.5) — `C` opens at cursor with curated + custom + recent colors.
- **Settings side panel** (M1.7) — brush preset tuning, custom swatches, theme, grid, advanced knobs, pressure curves (M2), predicted-events toggle (M2).
- **Keyboard shortcuts** — `B` / `P` (draw + pen), `1`–`5` (brush presets), `[` / `]` (size), `Shift+[`/`]` (palette cycle, M2), `S` (lasso), `E`-hold / `Shift+E` (eraser), `I` (eyedropper, M2), `Cmd/Ctrl+,` (settings), `Cmd/Ctrl+E` (export, M2), `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` (undo/redo), `T` (theme), `M` (metrics), `?` (help), `F` (distraction-free, M2).
- **Toolpill** (M1) — bottom-right indicator with tap-to-cycle and gear-zone (settings panel).

A toolbar would have provided one-click access (vs two-click via right-click) and visual discoverability for casual users. The user feel-tested through M0 / M1 / M1.5 / M1.7 and concluded the existing surfaces are sufficient.

The SPEC § 0 tenets ("Visual minimalism is functional. Less chrome = less cognitive load." and "Things that don't help drawing don't ship at all, or ship hidden by default.") override the SPEC § 4.2 commitment when they conflict.

## Decision

Drop the toolbar from M2 scope. Replace SPEC § 4.2 with a paragraph acknowledging that right-click + keyboard + settings panel cover per-action discovery.

The first-run hint (M2 `firstrun.ts`) provides discoverability for new users without persistent chrome.

## Considered alternatives

### Hidden-by-default toolbar (appears on hover near the top edge)

Compromise: toolbar exists but isn't always visible. Tradeoff: still adds DOM + reactivity surface; "hover to reveal" UX feels indirect on a Wacom Intuos (the cursor is a board-coords pointer, not a screen-coords pointer; hovering over a specific screen-edge requires a cognitive shift).

Rejected — the right-click menu is already a "reveal on demand" surface that's pen-native.

### Minimal pinned palette (color swatches only, no tools)

Compromise: drop the tool pills, keep only color swatches as a strip along one edge. Tradeoff: still persistent chrome; the `C` key + recent colors row inside the picker already serve this need, and `Shift+[/]` cycles through curated swatches without any visual pinning.

Rejected — partial implementation that doesn't actually solve the discoverability gap that the toolbar was supposed to address.

### Discoverable-on-first-use toolbar (shown once, then hideable)

Compromise: toolbar shows on first run; user can hide it via a setting; persists hidden across reloads.

Rejected — the first-run hint covers the discoverability problem at zero chrome cost. A toolbar that 90% of users hide is just dead code with a one-time appearance.

## Consequences

### Easier

- M2 scope contracted from 8 to 7 features (toolbar dropped; cursor preview drop is separate — see M2 spec § 2 locked decisions).
- No new architectural primitive (toolbar shell, dock model, drag-and-snap).
- No bundle-size impact from a reactive store framework. The original M2 spec brainstormed vanilla TS + nanostores vs Solid.js to support a toolbar's reactive store; with no toolbar, the existing `settings.ts` subscriber pattern + ADR 0007 Tool interface cover the small amount of reactivity M2 needs.

### Harder

- Casual users without keyboard or right-click familiarity discover features only through the first-run hint or the `?` help overlay. If feel-test reveals a gap, this decision can be reconsidered — the right-click + keyboard surfaces remain the source of truth, and a toolbar can be added later as an *additional* discoverability path without removing existing surfaces.

### Risks

- Future feature additions that "would have lived in the toolbar" need a deliberate home — settings panel, right-click section, or a new popover. Without a default chrome host, every new feature decision includes "where does this surface."

## Migration path forward

If a discoverability gap surfaces in M3+ feel-tests, a toolbar could be added as a new optional surface (not replacing the existing ones). The deferred design (vanilla TS + nanostores, edge-snap dock model, brush picker + palette + tool pills) is captured in the brainstorm history (`docs/superpowers/specs/2026-05-09-m2-export-polish-design.md` § 2 Locked decisions) and could be revived without re-brainstorming the structure.
