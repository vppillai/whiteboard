/**
 * Clear-board confirmation flow. Thin wrapper around the generalized
 * destructive-confirm primitive. See destructiveconfirm.ts for the
 * priming-toast pattern.
 */

import { createDestructiveConfirm, type DestructiveConfirm } from './destructiveconfirm'

export type ClearFlow = DestructiveConfirm

export interface ClearFlowOptions {
  onPerformClear: () => void
  refocusOnClose?: HTMLElement
}

export function createClearFlow(opts: ClearFlowOptions): ClearFlow {
  return createDestructiveConfirm({
    message: 'Clear the whole board?',
    confirmLabel: 'Clear',
    onConfirm: opts.onPerformClear,
    refocusOnClose: opts.refocusOnClose,
  })
}
