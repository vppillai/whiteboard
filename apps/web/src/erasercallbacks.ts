import type { Op, OpContext } from './ops'
import type { StampEdit } from './tools/eraser'

export interface EraserCommitDeps {
  opCtx: OpContext
  apply: (op: Op, ctx: OpContext) => void
  push: (op: Op) => void
}

export function createEraserCommitCallbacks(deps: EraserCommitDeps): {
  onObjectErase: (strokeId: string) => void
  onWipeErase: (edits: StampEdit[]) => void
  onWholeObjectErase: (deletes: { shapes: string[]; texts: string[]; images: string[] }) => void
} {
  const onObjectErase = (strokeId: string): void => {
    const op: Op = { kind: 'delete', strokeIds: [strokeId] }
    deps.apply(op, deps.opCtx)
    deps.push(op)
  }

  const onWipeErase = (edits: StampEdit[]): void => {
    if (edits.length === 0) return
    const op: Op = { kind: 'eraseStamps', edits }
    deps.apply(op, deps.opCtx)
    deps.push(op)
  }

  const onWholeObjectErase = (deletes: {
    shapes: string[]
    texts: string[]
    images: string[]
  }): void => {
    if (deletes.shapes.length === 0 && deletes.texts.length === 0 && deletes.images.length === 0) {
      return
    }
    const op: Op = {
      kind: 'delete-many',
      imageIds: deletes.images,
      textIds: deletes.texts,
      shapeIds: deletes.shapes,
      // Strokes erased during the same gesture commit per stroke via
      // onObjectErase as the cursor crosses them; whole-object erase
      // covers floating objects only.
      strokeIds: [],
    }
    deps.apply(op, deps.opCtx)
    deps.push(op)
  }

  return { onObjectErase, onWipeErase, onWholeObjectErase }
}
