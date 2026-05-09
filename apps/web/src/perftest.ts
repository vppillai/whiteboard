/**
 * Synthetic stroke harness. Drives a simulated 200 Hz pen at 3 seconds of
 * decreasing-radius spiral and reports the JS-side input-to-render latency.
 *
 * What this measures: the time from a synthetic sample's intended timestamp
 * to the next animation frame that processes it. With coalesced events used
 * correctly and a 60 Hz frame rate, expect mean ~8 ms, p95 ~16 ms.
 *
 * What this does NOT measure: pen-to-photon latency. JavaScript cannot
 * observe compositor or display latency. Real pen-to-photon validation
 * requires either a high-speed camera or a hardware timing rig.
 */

import type { Sample } from '@whiteboard/shared'

export interface PerfResult {
  totalSamples: number
  framesObserved: number
  durationMs: number
  /** Time from a synthetic sample's intended `t` to the frame it was rendered in. */
  eventToRenderMs: { mean: number; p50: number; p95: number; max: number }
  fps: number
}

export interface PerftestOptions {
  durationMs?: number
  rateHz?: number
}

/**
 * Runs the harness. `pushSample` should append the synthetic sample to the
 * in-flight stroke and mark the live layer dirty.
 */
export async function runPerftest(
  bounds: { width: number; height: number },
  pushSample: (s: Sample) => void,
  options: PerftestOptions = {},
): Promise<PerfResult> {
  const durationMs = options.durationMs ?? 3000
  const rateHz = options.rateHz ?? 200
  const sampleIntervalMs = 1000 / rateHz
  const totalSamples = Math.floor((durationMs / 1000) * rateHz)

  const cx = bounds.width / 2
  const cy = bounds.height / 2
  const r0 = Math.min(bounds.width, bounds.height) * 0.35

  const start = performance.now()
  const samples: Sample[] = []
  for (let i = 0; i < totalSamples; i++) {
    const u = i / totalSamples
    const theta = u * Math.PI * 6
    const r = r0 * (1 - 0.7 * u)
    samples.push({
      x: cx + Math.cos(theta) * r,
      y: cy + Math.sin(theta) * r,
      p: 0.4 + 0.4 * Math.sin(u * Math.PI),
      t: start + i * sampleIntervalMs,
    })
  }

  const latencies: number[] = []
  let frames = 0
  const pending = [...samples]

  return new Promise((resolve) => {
    const tick = (now: DOMHighResTimeStamp) => {
      while (pending.length > 0) {
        const head = pending[0]
        if (!head || head.t > now) break
        pending.shift()
        pushSample(head)
        latencies.push(now - head.t)
      }
      frames++

      if (pending.length === 0) {
        resolve(buildResult(latencies, frames, performance.now() - start, totalSamples))
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function buildResult(
  latencies: number[],
  frames: number,
  durationMs: number,
  totalSamples: number,
): PerfResult {
  if (latencies.length === 0) {
    return {
      totalSamples,
      framesObserved: frames,
      durationMs,
      eventToRenderMs: { mean: 0, p50: 0, p95: 0, max: 0 },
      fps: 0,
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b)
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  const sum = sorted.reduce((a, b) => a + b, 0)

  return {
    totalSamples,
    framesObserved: frames,
    durationMs,
    eventToRenderMs: {
      mean: r2(sum / sorted.length),
      p50: r2(at(0.5)),
      p95: r2(at(0.95)),
      max: r2(sorted[sorted.length - 1] ?? 0),
    },
    fps: Math.round((frames * 1000) / durationMs),
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100
