export function percentile(values: number[], fraction: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))]
}

export function cpuFromCounter(previous: { pid: number; seconds: number; at: number } | null, current: { pid: number; seconds: number; at: number }): number | null {
  if (!previous || previous.pid !== current.pid || current.at <= previous.at || current.seconds < previous.seconds) return null
  return (current.seconds - previous.seconds) / ((current.at - previous.at) / 1000) * 100
}

export function summarizeTimings(values: number[]) {
  const valid = values.filter(Number.isFinite)
  return { count: valid.length, meanMs: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    p50Ms: percentile(valid, .5), p95Ms: percentile(valid, .95), maxMs: valid.length ? valid.reduce((a, b) => Math.max(a, b)) : null }
}
