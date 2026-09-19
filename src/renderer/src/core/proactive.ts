/**
 * Proactive Engine - schedules the assistant's spontaneous messages.
 *
 * - Greet on first launch of the day (configurable)
 * - Remind the user to rest after 60 minutes of continuous use (configurable)
 * - At most one new proactive event per 60 minutes
 * - Delivered via callback; persistence lives in the assistant chat session
 */

const COOLDOWN = 60 * 60 * 1000 // 60 minutes
const REST_REMINDER_INTERVAL = 60 * 60 * 1000 // 60 minutes

export type ProactiveKind = 'greeting' | 'rest' | 'return' | 'task' | 'snooze'
type ProactiveCallback = (message: string, kind?: ProactiveKind) => void

export interface ProactiveOptions {
  greeting: boolean
  restReminder: boolean
}

export const SNOOZE_PREFIX = '⏰ 稍后提醒：'

export interface AssistantSnooze {
  id: string
  content: string
  dueAt: number
}

export class ProactiveEngine {
  private lastProactiveTime = 0
  private restTimer: ReturnType<typeof setTimeout> | null = null
  private callback: ProactiveCallback | null = null
  private greetedDate: string | null = null
  private greetingTimer: ReturnType<typeof setTimeout> | null = null
  private snoozes = new Map<string, AssistantSnooze>()
  private snoozeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private interrupted = false
  private options: ProactiveOptions = { greeting: true, restReminder: true }

  start(callback: ProactiveCallback, options?: ProactiveOptions): void {
    this.stop()
    this.callback = callback
    this.snoozes.forEach((item) => this.scheduleSnooze(item))
    this.scheduleIdleCheck()
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
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  /** Call this when user interacts to reset rest timer */
  userActivity(): void {
    if (!this.options.restReminder) return
    if (this.restTimer) clearTimeout(this.restTimer)
    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }

  snoozeContent(content: string, minutes = 10): void {
    if (!content.trim()) return
    const item: AssistantSnooze = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content: content.slice(0, 20_000),
      dueAt: Date.now() + minutes * 60_000
    }
    this.snoozes.set(item.id, item)
    this.scheduleSnooze(item)
    this.persistSnoozes()
  }

  /** 启动时从 db state 恢复待提醒项：未来项重挂定时器，过期项立即触发。 */
  restoreSnoozes(items: unknown): void {
    this.snoozes.clear()
    this.snoozeTimers.forEach(timer => clearTimeout(timer))
    this.snoozeTimers.clear()
    if (Array.isArray(items)) {
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as Partial<AssistantSnooze>
        if (typeof item.id !== 'string' || !item.id) continue
        if (typeof item.content !== 'string' || !item.content.trim()) continue
        if (!Number.isFinite(item.dueAt)) continue
        this.snoozes.set(item.id, { id: item.id.slice(0, 128), content: item.content.slice(0, 20_000), dueAt: Number(item.dueAt) })
      }
    }
    this.snoozes.forEach((item) => this.scheduleSnooze(item))
    this.persistSnoozes()
  }

  private canSpeak(): boolean {
    return Date.now() - this.lastProactiveTime > COOLDOWN
  }

  private speak(message: string, kind: ProactiveKind = 'rest'): void {
    if (!this.callback) return
    this.lastProactiveTime = Date.now()
    this.callback(message, kind)
  }

  private persistSnoozes(): void {
    if (typeof window === 'undefined' || !window.electronAPI?.db) return
    try {
      void window.electronAPI.db.setState('assistant-snoozes', JSON.stringify([...this.snoozes.values()]))
        .catch(() => { /* storage notice covers persistence failures */ })
    } catch { /* unavailable */ }
  }

  private scheduleSnooze(item: AssistantSnooze): void {
    const existing = this.snoozeTimers.get(item.id)
    if (existing) clearTimeout(existing)
    const delay = Math.max(0, item.dueAt - Date.now())
    const timer = setTimeout(() => {
      this.snoozes.delete(item.id)
      this.snoozeTimers.delete(item.id)
      this.persistSnoozes()
      this.callback?.(`${SNOOZE_PREFIX}${item.content}`, 'snooze')
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

    this.speak(greeting, 'greeting')
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
    this.speak(msg, 'rest')

    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }

  private scheduleIdleCheck(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => void this.checkIdle(), 15_000)
  }

  private async checkIdle(): Promise<void> {
    if (!this.callback || typeof window === 'undefined' || !window.electronAPI?.getSystemIdleSeconds) return
    try {
      const idleSeconds = await window.electronAPI.getSystemIdleSeconds()
      if (idleSeconds >= 600) this.interrupted = true
      else if (this.interrupted && idleSeconds < 30 && this.canSpeak()) {
        this.interrupted = false
        this.speak('欢迎回来。要接着刚才的工作吗？', 'return')
      }
    } catch { /* system idle is optional on unsupported platforms */ }
    this.scheduleIdleCheck()
  }
}

export const proactiveEngine = new ProactiveEngine()
