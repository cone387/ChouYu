import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG, normalizeConfig, sanitizeConfigPatch } from './config'

describe('config', () => {
  it('migrates an old partial config with safe defaults', () => {
    const config = normalizeConfig({ model: 'custom-model', autoStart: true })

    expect(config.model).toBe('custom-model')
    expect(config.autoStart).toBe(true)
    expect(config.proactiveGreeting).toBe(true)
    expect(config.proactiveRestReminder).toBe(true)
    expect(config.clipboardWatch).toBe(false)
    expect(config.soulMd).toBe(DEFAULT_APP_CONFIG.soulMd)
  })

  it('clamps and aligns pet size to the supported range', () => {
    expect(normalizeConfig({ petSize: 13 }).petSize).toBe(40)
    expect(normalizeConfig({ petSize: 167 }).petSize).toBe(160)
    expect(normalizeConfig({ petSize: 83 }).petSize).toBe(80)
  })

  it('accepts only known patch fields and valid primitive types', () => {
    const patch = sanitizeConfigPatch({
      provider: 'claude',
      autoStart: true,
      petSize: 96,
      unknown: 'ignored',
      model: 123
    })

    expect(patch).toEqual({ provider: 'claude', autoStart: true, petSize: 96 })
  })
})
