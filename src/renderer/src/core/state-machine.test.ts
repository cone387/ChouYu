import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StateMachine } from './state-machine'

describe('state machine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('enters sleeping after the idle timeout', () => {
    const machine = new StateMachine(1000)
    machine.userActivity()

    vi.advanceTimersByTime(999)
    expect(machine.getState()).toBe('idle')

    vi.advanceTimersByTime(1)
    expect(machine.getState()).toBe('sleeping')
    machine.destroy()
  })

  it('wakes on activity and restarts the idle timer', () => {
    const machine = new StateMachine(1000)
    machine.userActivity()
    vi.advanceTimersByTime(1000)
    expect(machine.getState()).toBe('sleeping')

    machine.userActivity()
    expect(machine.getState()).toBe('idle')
    vi.advanceTimersByTime(999)
    expect(machine.getState()).toBe('idle')

    vi.advanceTimersByTime(1)
    expect(machine.getState()).toBe('sleeping')
    machine.destroy()
  })

  it('does not sleep while thinking or talking', () => {
    const machine = new StateMachine(1000)
    machine.transition('thinking')
    vi.advanceTimersByTime(2000)
    expect(machine.getState()).toBe('thinking')

    machine.transition('talking')
    vi.advanceTimersByTime(2000)
    expect(machine.getState()).toBe('talking')

    machine.transition('idle')
    vi.advanceTimersByTime(1000)
    expect(machine.getState()).toBe('sleeping')
    machine.destroy()
  })
})
