/**
 * Proactive Engine - makes the pet speak on its own occasionally.
 *
 * Rules:
 * - Greet on first launch of the day (configurable)
 * - Remind user to rest after 60 minutes of continuous use (configurable)
 * - Max 1 proactive message per 60 minutes
 */

const COOLDOWN = 60 * 60 * 1000 // 60 minutes
const REST_REMINDER_INTERVAL = 60 * 60 * 1000 // 60 minutes

type ProactiveCallback = (message: string) => void

export interface ProactiveMessage {
  id: string
  message: string
  createdAt: number
  readAt?: number
  snoozedUntil?: number
}

export interface ProactiveOptions {
  greeting: boolean
  restReminder: boolean
}

class ProactiveEngine {
  private lastProactiveTime = 0
  private restTimer: ReturnType<typeof setTimeout> | null = null
  private callback: ProactiveCallback | null = null
  private greetedDate: string | null = null
  private greetingTimer: ReturnType<typeof setTimeout> | null = null
  private snoozeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private options: ProactiveOptions = { greeting: true, restReminder: true }
  private messages: ProactiveMessage[] = []

  getMessages(): ProactiveMessage[] { return [...this.messages] }

  snooze(id: string, minutes = 10): void {
    const item = this.messages.find(message => message.id === id)
    if (!item) return
    item.snoozedUntil = Date.now() + minutes * 60_000
    this.persistMessages()
    this.scheduleSnooze(item)
  }

  markAllRead(): void {
    const now = Date.now()
    this.messages.forEach(message => { if (!message.readAt) message.readAt = now })
    this.persistMessages()
  }

  remove(id: string): void {
    this.messages = this.messages.filter(message => message.id !== id)
    const timer = this.snoozeTimers.get(id)
    if (timer) clearTimeout(timer)
    this.snoozeTimers.delete(id)
    this.persistMessages()
  }

  clearMessages(): void {
    this.messages = []
    this.snoozeTimers.forEach(timer => clearTimeout(timer))
    this.snoozeTimers.clear()
    this.persistMessages()
  }

  start(callback: ProactiveCallback, options?: ProactiveOptions): void {
    this.stop()
    this.callback = callback
    this.messages = this.readMessages()
    this.messages.forEach(message => this.scheduleSnooze(message))
    this.options = options || { greeting: true, restReminder: true }
    this.greetedDate = this.readGreetingDate()

    // Greet after a short delay
    if (this.options.greeting && this.greetedDate !== this.today()) {
      this.greetingTimer = setTimeout(() => this.tryGreet(), 3000)
    }

    // Start rest reminder timer
    if (this.options.restReminder) {
      this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
    }
  }

  stop(): void {
    this.callback = null
    if (this.restTimer) {
      clearTimeout(this.restTimer)
      this.restTimer = null
    }
    if (this.greetingTimer) { clearTimeout(this.greetingTimer); this.greetingTimer = null }
    this.snoozeTimers.forEach(timer => clearTimeout(timer))
    this.snoozeTimers.clear()
  }

  /** Call this when user interacts to reset rest timer */
  userActivity(): void {
    if (!this.options.restReminder) return
    if (this.restTimer) clearTimeout(this.restTimer)
    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }

  private canSpeak(): boolean {
    return Date.now() - this.lastProactiveTime > COOLDOWN
  }

  private speak(message: string): void {
    if (!this.callback) return
    this.lastProactiveTime = Date.now()
    this.messages.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message, createdAt: Date.now() })
    this.persistMessages()
    this.callback(message)
  }

  private readMessages(): ProactiveMessage[] {
    try { const value = JSON.parse(localStorage.getItem('chouyu.proactive.messages') || '[]'); return Array.isArray(value) ? value : [] } catch { return [] }
  }

  private persistMessages(): void {
    try { localStorage.setItem('chouyu.proactive.messages', JSON.stringify(this.messages)) } catch { /* unavailable */ }
  }

  private scheduleSnooze(item: ProactiveMessage): void {
    const current = this.snoozeTimers.get(item.id)
    if (current) clearTimeout(current)
    if (!item.snoozedUntil) return
    const delay = Math.max(0, item.snoozedUntil - Date.now())
    const timer = setTimeout(() => {
      this.snoozeTimers.delete(item.id)
      item.snoozedUntil = undefined
      this.persistMessages()
      this.callback?.(item.message)
    }, delay)
    this.snoozeTimers.set(item.id, timer)
  }

  private today(): string {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  private tryGreet(): void {
    const today = this.today()
    if (this.greetedDate === today || !this.canSpeak()) return
    this.greetedDate = today
    try { localStorage.setItem('chouyu.proactive.greetingDate', today) } catch { /* unavailable */ }

    const hour = new Date().getHours()
    let greeting: string
    if (hour < 6) greeting = '这么晚还没睡呀...要注意休息哦 (´-ω-`)'
    else if (hour < 9) greeting = '早上好～新的一天开始啦 ☀️'
    else if (hour < 12) greeting = '上午好，今天也要加油鸭～'
    else if (hour < 14) greeting = '中午好～吃饭了没？'
    else if (hour < 18) greeting = '下午好，继续努力 (ง •_•)ง'
    else if (hour < 22) greeting = '晚上好～今天辛苦了'
    else greeting = '夜深了，别太晚睡哦 🌙'

    this.speak(greeting)
  }

  private readGreetingDate(): string | null {
    try { return localStorage.getItem('chouyu.proactive.greetingDate') } catch { return null }
  }

  private remindRest(): void {
    if (!this.canSpeak()) {
      this.restTimer = setTimeout(() => this.remindRest(), 10 * 60 * 1000)
      return
    }

    const messages = [
      '你已经连续工作一小时了，起来活动活动吧～ 🧘',
      '该休息一下了，看看远处放松眼睛 👀',
      '久坐不好哦，站起来伸个懒腰吧～',
      '喝杯水休息一下？你已经坐了好一会儿了 ☕'
    ]
    const msg = messages[Math.floor(Math.random() * messages.length)]
    this.speak(msg)

    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }
}

export const proactiveEngine = new ProactiveEngine()
