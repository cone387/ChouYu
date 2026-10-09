/** Companion reminders use system activity; opening the panel is not a rest. */
const HOUR = 60 * 60_000
const POLL = 15_000
const BREAK_SECONDS = 5 * 60
export type ProactiveKind = 'greeting' | 'rest' | 'return' | 'task' | 'snooze'
type ProactiveCallback = (message: string, kind?: ProactiveKind, deliveryId?: string, context?: { leftAt: number }) => void | Promise<void>
export interface ProactiveOptions { greeting: boolean; restReminder: boolean; returnReminder?: boolean; awayMinutes?: number; restMinutes?: number; cooldownMinutes?: number }
export const SNOOZE_PREFIX = '⏰ 稍后提醒：'

export class ProactiveEngine {
  private timer: ReturnType<typeof setTimeout> | null = null
  private callback: ProactiveCallback | null = null
  private options: ProactiveOptions = { greeting: true, restReminder: true, returnReminder: true }
  private generation = 0
  private lastAt = 0
  private activeMs = 0
  private away = false
  private leftAt = 0
  private lastSpokenAt = 0
  private restId = ''
  private awaySeconds = 600
  private restMs = HOUR
  private cooldownMs = HOUR

  start(callback: ProactiveCallback, options?: ProactiveOptions): void {
    this.stop()
    this.callback = callback
    this.options = options ?? { greeting: true, restReminder: true, returnReminder: true }
    this.awaySeconds = Math.max(60, (options?.awayMinutes ?? 10) * 60)
    this.restMs = Math.max(10, options?.restMinutes ?? 60) * 60000
    this.cooldownMs = Math.max(5, options?.cooldownMinutes ?? 60) * 60000
    this.lastAt = Date.now()
    this.restId = `rest:${Date.now()}:${Math.random()}`
    this.timer = setTimeout(() => void this.tick(this.generation), 3000)
  }
  stop(): void {
    this.generation++
    this.callback = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.activeMs = 0
    this.away = false
  }
  /** Panel interaction must not reset the continuous-use estimate. */
  userActivity(): void {}
  private today(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  private read(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }
  private write(key: string, value: string): void {
    try { localStorage.setItem(key, value) } catch { /* optional companion state */ }
  }
  private async tick(generation: number): Promise<void> {
    if (!this.callback || generation !== this.generation) return
    try {
      const idle = await window.electronAPI.getSystemIdleSeconds()
      if (!Number.isFinite(idle) || idle < 0 || generation !== this.generation || !this.callback) return
      const now = Date.now(), elapsed = now - this.lastAt
      this.lastAt = now
      // Long timer gaps include sleep/suspension; never count them as computer use.
      if (elapsed > 60_000 || elapsed < 0 || idle >= BREAK_SECONDS) this.activeMs = 0
      else if (idle < 60) this.activeMs += elapsed
      if (!this.away && (idle >= this.awaySeconds || elapsed >= 600_000)) {
        this.away = true
        this.leftAt = now - Math.max(idle * 1000, elapsed)
      }
      const returned = this.away && idle < 30
      if (returned) this.away = false // consume even during cooldown: never greet an hour late
      if (idle >= 60) return
      const today = this.today()
      const canSpeak = now - this.lastSpokenAt >= this.cooldownMs
      if (this.options.greeting && this.read('chouyu.proactive.greetingDate') !== today) {
        const hour = new Date().getHours()
        const greeting = hour < 6 ? '这么晚还没睡呀…记得照顾好自己。' : hour < 12 ? '早上好～新的一天，我陪你一起。' : hour < 18 ? '下午好～我在这里，随时陪你接着做。' : '晚上好～今天辛苦了。'
        await this.callback(greeting, 'greeting', `greeting:${today}`)
        if (generation !== this.generation) return
        this.write('chouyu.proactive.greetingDate', today)
        this.lastSpokenAt = now
      } else if (returned && this.options.returnReminder !== false && canSpeak) {
        await this.callback('欢迎回来～我一直在。准备好后，我们接着做。', 'return', `return:${now}`, { leftAt: this.leftAt })
        if (generation !== this.generation) return
        this.lastSpokenAt = now
      } else if (this.options.restReminder && this.activeMs >= this.restMs && canSpeak) {
        await this.callback('已经使用电脑一段时间了，陪你歇一会儿～喝口水，看看远处吧。', 'rest', this.restId)
        if (generation !== this.generation) return
        this.restId = `rest:${now}:${Math.random()}`
        this.activeMs = 0
        this.lastSpokenAt = now
      }
    } catch { /* Retry on the next sample; failed delivery does not consume the reminder. */ }
    finally {
      if (generation === this.generation) this.timer = setTimeout(() => void this.tick(generation), POLL)
    }
  }
}
export const proactiveEngine = new ProactiveEngine()
