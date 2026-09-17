export interface TrayFlasherOptions {
  showNormal: () => void
  showBlank: () => void
  intervalMs?: number
}

/** Alternates between two display callbacks on a timer; stop() always restores normal. */
export class TrayFlasher {
  private timer: ReturnType<typeof setInterval> | null = null
  private blank = false

  constructor(private readonly options: TrayFlasherOptions) {}

  get running(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    this.blank = false
    this.timer = setInterval(() => {
      this.blank = !this.blank
      if (this.blank) this.options.showBlank()
      else this.options.showNormal()
    }, this.options.intervalMs ?? 600)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.blank = false
    this.options.showNormal()
  }

  dispose(): void {
    this.stop()
  }
}
