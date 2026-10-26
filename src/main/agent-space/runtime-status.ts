import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs'
import type { ContactRuntimeSnapshot } from '../../shared/contact-runtime'
import { contactStorageDiagnostic } from '../storage/contact-database'

/** Main-process authority. Worker observations never determine the process generation. */
export class ContactRuntimeState {
  private value: ContactRuntimeSnapshot = { phase: 'idle', generation: 0, revision: 0, restartCount: 0 }
  constructor(private changed: (snapshot: ContactRuntimeSnapshot) => void = () => {}) {}
  read(): ContactRuntimeSnapshot { return structuredClone(this.value) }
  start(now = Date.now()): number {
    const generation = this.value.generation + 1
    this.value = { ...this.value, generation, restartCount: generation - 1, startedAt: now,
      readyAt: undefined, metrics: undefined, phase: generation === 1 ? 'starting' : 'recovering', revision: this.value.revision + 1 }
    this.changed(this.read()); return generation
  }
  update(generation: number, patch: Partial<Omit<ContactRuntimeSnapshot, 'generation' | 'revision' | 'restartCount'>>): void {
    if (generation !== this.value.generation) return
    this.value = { ...this.value, ...structuredClone(patch), revision: this.value.revision + 1 }
    if (patch.metrics) this.value.observedAt = patch.metrics.observedAt
    if (this.value.phase !== 'ready') this.value.metrics = undefined
    this.changed(this.read())
  }
}

export function runtimeDiagnostic(raw: unknown, generation: number, at = Date.now()) {
  const event = raw as { method?: unknown; phase?: unknown; elapsedMs?: unknown; queueMs?: unknown; executionMs?: unknown; storage?: unknown }
  const storage = contactStorageDiagnostic(event?.storage)
  return { at, generation,
    method: typeof event?.method === 'string' && /^[a-zA-Z]{1,64}$/.test(event.method) ? event.method : 'unknown',
    phase: typeof event?.phase === 'string' && /^(startup|queue|running|unresponsive|failed:(startup|queue|running)|completed:(startup|queue|running)|storage-retry:[1-3])$/.test(event.phase) ? event.phase : 'unknown',
    ...(typeof event?.elapsedMs === 'number' && Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0 ? { elapsedMs: event.elapsedMs } : {}),
    ...(typeof event?.queueMs === 'number' && Number.isFinite(event.queueMs) && event.queueMs >= 0 ? { queueMs: event.queueMs } : {}),
    ...(typeof event?.executionMs === 'number' && Number.isFinite(event.executionMs) && event.executionMs >= 0 ? { executionMs: event.executionMs } : {}),
    ...(storage ? { storage } : {}) }
}

export function appendRuntimeDiagnostic(filename: string, event: ReturnType<typeof runtimeDiagnostic>): void {
  // Keep one previous bounded log so a successful restart doesn't erase its failure.
  try {
    if (existsSync(filename) && statSync(filename).size >= 65536) {
      if (existsSync(filename + '.1')) unlinkSync(filename + '.1')
      renameSync(filename, filename + '.1')
    }
    appendFileSync(filename, JSON.stringify(event) + '\n')
  } catch { /* Diagnostics cannot fail a persisted operation or its recovery. */ }
}
