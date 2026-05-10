/**
 * Live metrics + on-screen HUD. Toggle with `M`. Always-on collection so the
 * numbers reflect actual drawing, not a separate test mode.
 *
 * Metrics tracked:
 *   - fps:           rolling 1-second frame rate.
 *   - eventsPerSec:  pointermove rate from the OS to JS.
 *   - samplesPerEvent: average coalesced samples per pointermove.
 *                  >1 means we're actually getting Wacom 200Hz packed into 60Hz frames.
 *   - eventToFrameMs: time from last pointer event to the next animation frame.
 */

export interface Metrics {
  fps: number
  eventsPerSec: number
  samplesPerEvent: number
  eventToFrameMs: number
}

export class MetricsCollector {
  state: Metrics = { fps: 0, eventsPerSec: 0, samplesPerEvent: 0, eventToFrameMs: 0 }

  private frameCount = 0
  private windowStart = performance.now()
  private eventCount = 0
  private sampleCount = 0
  private lastEventTime = 0

  noteFrame(now: number = performance.now()): void {
    this.frameCount++

    if (this.lastEventTime > 0) {
      this.state.eventToFrameMs = round1(now - this.lastEventTime)
      this.lastEventTime = 0
    }

    const elapsed = now - this.windowStart
    if (elapsed >= 1000) {
      this.state.fps = Math.round((this.frameCount * 1000) / elapsed)
      this.state.eventsPerSec = Math.round((this.eventCount * 1000) / elapsed)
      this.state.samplesPerEvent =
        this.eventCount > 0 ? round1(this.sampleCount / this.eventCount) : 0
      this.frameCount = 0
      this.eventCount = 0
      this.sampleCount = 0
      this.windowStart = now
    }
  }

  notePointerEvent(coalescedSampleCount: number): void {
    this.eventCount++
    this.sampleCount += coalescedSampleCount
    this.lastEventTime = performance.now()
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10

export interface Hud {
  el: HTMLElement
  update: (m: Metrics) => void
  setVisible: (visible: boolean) => void
  toggle: () => void
}

export function createHud(): Hud {
  const el = document.createElement('div')
  el.id = 'whiteboard-hud'
  el.style.cssText = [
    'position:fixed',
    'top:8px',
    'right:8px',
    'padding:8px 12px',
    'background:rgba(20,24,30,0.85)',
    'color:#cfeeff',
    'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'border-radius:6px',
    'pointer-events:none',
    'z-index:1000',
    'min-width:180px',
    'white-space:pre',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
  ].join(';')
  el.textContent = 'press M to hide'

  const update = (m: Metrics) => {
    el.textContent = [
      `fps             ${m.fps}`,
      `events / s      ${m.eventsPerSec}`,
      `samples / event ${m.samplesPerEvent}`,
      `event → frame   ${m.eventToFrameMs} ms`,
    ].join('\n')
  }

  const setVisible = (visible: boolean) => {
    el.style.display = visible ? 'block' : 'none'
  }

  const toggle = () => setVisible(el.style.display === 'none')

  return { el, update, setVisible, toggle }
}

export function bindHudToggle(hud: Hud, key = 'm'): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key.toLowerCase() === key) hud.toggle()
  }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}
