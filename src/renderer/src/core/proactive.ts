/**
 * Proactive Engine - makes the pet speak on its own occasionally.
 *
 * Rules:
 * - Greet on first launch of the day
 * - Remind user to rest after 60 minutes of continuous use
 * - Max 1 proactive message per 60 minutes
 */

const COOLDOWN = 60 * 60 * 1000 // 60 minutes
const REST_REMINDER_INTERVAL = 60 * 60 * 1000 // 60 minutes

type ProactiveCallback = (message: string) => void

class ProactiveEngine {
  private lastProactiveTime = 0
  private startTime = Date.now()
  private restTimer: ReturnType<typeof setTimeout> | null = null
  private callback: ProactiveCallback | null = null
  private greeted = false

  start(callback: ProactiveCallback): void {
    this.callback = callback
    this.startTime = Date.now()

    // Greet after a short delay
    setTimeout(() => this.tryGreet(), 3000)

    // Start rest reminder timer
    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }

  stop(): void {
    this.callback = null
    if (this.restTimer) {
      clearTimeout(this.restTimer)
      this.restTimer = null
    }
  }

  /** Call this when user interacts to reset rest timer */
  userActivity(): void {
    if (this.restTimer) clearTimeout(this.restTimer)
    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }

  private canSpeak(): boolean {
    return Date.now() - this.lastProactiveTime > COOLDOWN
  }

  private speak(message: string): void {
    if (!this.callback) return
    this.lastProactiveTime = Date.now()
    this.callback(message)
  }

  private async tryGreet(): Promise<void> {
    if (this.greeted || !this.canSpeak()) return
    this.greeted = true

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

  private remindRest(): void {
    if (!this.canSpeak()) {
      // Retry later
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

    // Schedule next reminder
    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }
}

export const proactiveEngine = new ProactiveEngine()
