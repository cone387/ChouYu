import { describe, expect, it } from 'vitest'
import { PROCESS_CAPABILITY_PROTOCOL_VERSION, validateProcessCapabilityManifest } from './process-bridge'

describe('process capability bridge contract', () => {
  it('validates a JSONL helper manifest without starting a process', () => {
    expect(validateProcessCapabilityManifest({ id: 'mem0-oss', command: 'node', args: ['helper.js'], protocol: 'jsonl' })).toMatchObject({ id: 'mem0-oss', protocol: 'jsonl', timeoutMs: 30000 })
    expect(PROCESS_CAPABILITY_PROTOCOL_VERSION).toBe(1)
  })

  it('rejects unsafe or unsupported manifests', () => {
    expect(() => validateProcessCapabilityManifest({ id: 'Mem0 OSS', command: 'node', protocol: 'jsonl' })).toThrow(/ID/)
    expect(() => validateProcessCapabilityManifest({ id: 'mem0-oss', command: 'node', protocol: 'stdio' })).toThrow(/JSONL/)
    expect(() => validateProcessCapabilityManifest({ id: 'mem0-oss', command: 'node', protocol: 'jsonl', timeoutMs: 10 })).toThrow(/超时/)
  })
})
