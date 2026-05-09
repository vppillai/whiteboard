/**
 * Local persistence via IndexedDB. v1 of the local store; replaced / extended
 * once Y.js + server sync ships at M3.
 *
 * Single object store keyed on stroke id. Each stroke is written individually
 * on commit so a power-loss event at most loses the in-flight stroke.
 */

import type { Stroke } from '@whiteboard/shared'

const DB_NAME = 'whiteboard-local'
const DB_VERSION = 1
const STORE_STROKES = 'strokes'

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_STROKES)) {
          db.createObjectStore(STORE_STROKES, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

export async function saveStroke(stroke: Stroke): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STROKES, 'readwrite')
    tx.objectStore(STORE_STROKES).put(stroke)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

export async function loadAllStrokes(): Promise<Stroke[]> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STROKES, 'readonly')
    const req = tx.objectStore(STORE_STROKES).getAll()
    req.onsuccess = () => {
      const strokes = (req.result as Stroke[]).slice()
      strokes.sort((a, b) => a.startedAt - b.startedAt)
      resolve(strokes)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteStroke(id: string): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STROKES, 'readwrite')
    tx.objectStore(STORE_STROKES).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearAllStrokes(): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STROKES, 'readwrite')
    tx.objectStore(STORE_STROKES).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
