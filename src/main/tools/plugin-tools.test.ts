import { describe, expect, it } from 'vitest'
import { toPluginToolName } from './plugin-tools'

describe('plugin tools', () => {
  it('creates a provider-compatible deterministic tool name', () => {
    expect(toPluginToolName('BBTalk')).toBe('plugin_bbtalk')
    expect(toPluginToolName('my-plugin.v2')).toBe('plugin_my_plugin_v2')
  })
})
