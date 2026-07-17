/**
 * Shared editable-target guards for document-level key listeners.
 *
 * Four modules listen for keys on `document` (keymap.ts, sidepanel.ts,
 * pan.ts, eraserhold.ts). None of their bindings may fire while the user
 * is typing into an editable — the settings panel's inputs or the text
 * tool's contenteditable editor (which also defends itself via
 * stopPropagation, but the guard keeps non-bubbling edge cases and plain
 * inputs safe). Keeping the predicates here — not inlined per listener —
 * is what prevents the "one listener guarded, the next one added isn't"
 * regression class (v1.5 review finding: typing `e` / Space into the hex
 * field spring-loaded the eraser / armed pan while keymap.ts was already
 * correctly guarded).
 *
 * Two tiers, because "editable" isn't one thing:
 *
 *   - `isTextEntryTarget` — TEXT-ENTRY controls only. A bare `input`
 *     selector also matches range sliders / checkboxes, and browsers
 *     leave focus on those after a click — with the broad guard, one
 *     drag of a settings slider silently killed every shortcut
 *     (including Esc and Cmd+,) until the user clicked elsewhere.
 *     Shortcut dispatchers (keymap, sidepanel Esc) use this one.
 *
 *   - `isEditableTarget` — ANY form control. Hold-style modifiers
 *     (Space-pan, E-eraser) use this broader net: Space is also the
 *     activation key for checkboxes/buttons, so arming pan there is
 *     wrong even though no text is being typed.
 *
 * IMPORTANT for hold-style modifiers: guard the *keydown* only. Keyup
 * must always be processed — if the user presses the key on canvas,
 * focuses an input, then releases, a guarded keyup would leave the
 * held-state stuck on forever.
 */

const TEXT_ENTRY_SELECTOR = [
  'textarea',
  '[contenteditable]',
  'input:not([type])',
  'input[type="text"]',
  'input[type="search"]',
  'input[type="number"]',
  'input[type="email"]',
  'input[type="url"]',
  'input[type="tel"]',
  'input[type="password"]',
].join(', ')

const ANY_EDITABLE_SELECTOR = 'input, textarea, [contenteditable]'

// Both predicates duck-type `target.closest` rather than `instanceof
// Element` — keydown targets are always Elements in practice, and duck
// typing keeps them usable from bun tests (no DOM) with plain-object
// event stubs.
function closestMatches(target: EventTarget | null, selector: string): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null
  return typeof el?.closest === 'function' && el.closest(selector) != null
}

/** True when the key event is aimed at a control the user TYPES into. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return closestMatches(target, TEXT_ENTRY_SELECTOR)
}

/** True when the key event is aimed at any form control / editable. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return closestMatches(target, ANY_EDITABLE_SELECTOR)
}
