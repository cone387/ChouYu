import { PetState } from '../shared/types'
import { SLEEP_TIMEOUT } from '../shared/constants'

type StateListener = (state: PetState) => void

class StateMachine {
  private state: PetState = 'idle'
  private listeners: StateListener[] = []
  private sleepTimer: ReturnType<typeof setTimeout> | null = null

  getState(): PetState {
    return this.state
  }

  transition(newState: PetState): void {
    if (this.state === newState) return
    this.state = newState
    this.listeners.forEach((fn) => fn(newState))
    this.resetSleepTimer()
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== listener)
    }
  }

  userActivity(): void {
    if (this.state === 'sleeping') {
      this.transition('idle')
    }
    this.resetSleepTimer()
  }

  private resetSleepTimer(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    if (this.state === 'idle') {
      this.sleepTimer = setTimeout(() => {
        this.transition('sleeping')
      }, SLEEP_TIMEOUT)
    }
  }

  destroy(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.listeners = []
  }
}

export const stateMachine = new StateMachine()
