/**
 * Reset-to-defaults confirmation flow. Wipes Scope-B targets per spec § 6.1.7
 * (presets, customSwatches, recentColors, scalar settings) on confirm.
 * Theme intentionally not touched — see spec § 9.
 */

import { type DestructiveConfirm, createDestructiveConfirm } from './destructiveconfirm'
import { resetAll } from './settings'

export type ResetFlow = DestructiveConfirm

export interface ResetFlowOptions {
  refocusOnClose?: HTMLElement
}

export function createResetFlow(opts: ResetFlowOptions = {}): ResetFlow {
  return createDestructiveConfirm({
    message: 'Reset all settings? Custom swatches and recent colors will be cleared.',
    confirmLabel: 'Reset',
    onConfirm: resetAll,
    refocusOnClose: opts.refocusOnClose,
  })
}
