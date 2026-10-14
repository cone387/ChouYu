import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from './agents'
import { applyContactWorkSettingsPatch, contactWorkSettingProperties, describeContactWorkSettingsPatch, validateContactWorkSettingsPatch } from './contact-work-settings'

const current: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, goal: '保留方向', sources: ['https://example.org/'], dailyTokenLimit: 5000, notifyProgress: true }
describe('conversational work setting coverage', () => {
  it.each([
    { goal: '以后先给结论和依据' }, { notifyProgress: false }, { toolPermissionMode: 'full' },
    { permissionLevel: 'sources', sources: ['https://example.com/'], searchEnabled: false },
    { permissionLevel: 'public', searchEnabled: true, dailySearches: 12 },
    { shareDeliveries: true, readContactDeliveries: true }
  ])('validates, applies and describes explicit settings %j', raw => {
    const patch = validateContactWorkSettingsPatch(raw)
    expect(applyContactWorkSettingsPatch(current, patch)).toMatchObject(raw)
    expect(applyContactWorkSettingsPatch(current, patch).dailyTokenLimit).toBe(5000)
    expect(describeContactWorkSettingsPatch(patch).length).toBeGreaterThan(0)
    expect(current.goal).toBe('保留方向')
  })
  it('validates individual patch fields before validating dependencies against actual saved settings', () => {
    const patch = validateContactWorkSettingsPatch({ permissionLevel: 'sources' })
    expect(applyContactWorkSettingsPatch(current, patch).sources).toEqual(current.sources)
    expect(() => applyContactWorkSettingsPatch({ ...current, sources: [] }, patch)).toThrow('至少')
    expect(() => applyContactWorkSettingsPatch({ ...current, searchEnabled: true }, patch)).toThrow('搜索')
    expect(applyContactWorkSettingsPatch({ ...current, permissionLevel: 'sources' }, validateContactWorkSettingsPatch({ permissionLevel: 'public', sources: [] })).sources).toEqual([])
  })
  it.each([
    { notifyProgress: 'false' }, { searchEnabled: 1 }, { shareDeliveries: null }, { readContactDeliveries: 'yes' },
    { dailySearches: 0 }, { dailySearches: 25 }, { dailySearches: 1.5 }, { toolPermissionMode: 'never' },
    { permissionLevel: 'all' }, { sources: ['http://example.com'] }, { sources: ['https://user:password@example.com'] },
    { sources: ['https://example.com?api_key=secret'] }, { sources: Array(6).fill('https://example.com') },
    { sources: 'https://example.com' }, { goal: '' }, { goal: 'x'.repeat(2001) },
    { permissionLevel: 'sources', sources: [] }, { permissionLevel: 'sources', searchEnabled: true },
    { unknown: true }, { notifyProgress: undefined }, { __proto__: { enabled: true } }
  ])('rejects invalid settings without changing the source: %j', raw => {
    expect(() => validateContactWorkSettingsPatch(raw)).toThrow()
    expect(current).toMatchObject({ goal: '保留方向', notifyProgress: true, dailyTokenLimit: 5000 })
  })
  it('has a chat field for every editable work setting, with explicit work-hours endpoints', () => {
    const keys: (keyof AgentSettings)[] = ['enabled', 'goal', 'sources', 'intervalMinutes', 'dailyCalls', 'dailyTokenLimit', 'defaultTaskTokenLimit', 'maxConcurrentTasks', 'paceWriting', 'notifyProgress', 'permissionLevel', 'searchEnabled', 'dailySearches', 'toolPermissionMode', 'shareDeliveries', 'readContactDeliveries']
    for (const key of keys) expect(Object.hasOwn(contactWorkSettingProperties, key), key).toBe(true)
    expect(contactWorkSettingProperties).toHaveProperty('workStart')
    expect(contactWorkSettingProperties).toHaveProperty('workEnd')
  })
  it('copies arrays so a later caller mutation cannot change a prepared patch', () => {
    const raw = { sources: ['https://example.com/'] }
    const patch = validateContactWorkSettingsPatch(raw)
    raw.sources.push('https://other.example/')
    expect(applyContactWorkSettingsPatch(current, patch).sources).toEqual(['https://example.com/'])
  })
})
