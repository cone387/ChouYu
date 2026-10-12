import type { ReadingPosition } from '../../../../shared/contact-content'

/** One write at a time; an older failure cannot replace newer input. */
export class ReadingSaveQueue {
  private pending?: { position: ReadingPosition; generation: number }
  private generation = 0
  private running?: Promise<void>
  constructor(private save: (position: ReadingPosition) => Promise<void>, private saved: (position: ReadingPosition) => void, private failed: (error: unknown) => void) {}
  record(position: ReadingPosition) { this.pending = { position, generation: ++this.generation } }
  flush(): Promise<void> {
    if (this.running) return this.running
    this.running = this.drain().finally(() => { this.running = undefined })
    return this.running
  }
  private async drain() {
    while (this.pending) {
      const current = this.pending; this.pending = undefined
      try { await this.save(current.position); if (current.generation === this.generation) this.saved(current.position) }
      catch (error) {
        if (current.generation === this.generation) { this.pending = current; this.failed(error); break }
      }
    }
  }
}
