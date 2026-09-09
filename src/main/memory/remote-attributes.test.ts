import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../../shared/memory'
import { remoteMemoryAttributes } from './remote-attributes'

const current = { type: 'project', importance: .8, sensitivity: 'sensitive', status: 'archived', expiresAt: 100, sourceSessionId: 'session', sourceMessageId: 'message' } as MemoryRecord
describe('remote memory attributes', () => {
  it('preserves absent fields and uses defaults only for new records', () => {
    expect(remoteMemoryAttributes({}, current)).toEqual(current)
    expect(remoteMemoryAttributes({})).toMatchObject({ type: 'fact', importance: .6, sensitivity: 'normal', status: 'active', expiresAt: undefined })
  })
  it('accepts explicit updates and clears only nullable fields', () => {
    expect(remoteMemoryAttributes({ chouyu_type: 'workflow', chouyu_importance: 0, chouyu_sensitivity: 'normal', chouyu_status: 'active', chouyu_expires_at: null, chouyu_source_session_id: null, chouyu_source_message_id: 'new' }, current))
      .toEqual({ type: 'workflow', importance: 0, sensitivity: 'normal', status: 'active', expiresAt: undefined, sourceSessionId: undefined, sourceMessageId: 'new' })
  })
  it.each([{ chouyu_importance: NaN }, { chouyu_importance: '0.8' }, { chouyu_importance: 2 }, { chouyu_type: 'unknown' }, { chouyu_status: 'pending' }, { chouyu_sensitivity: null }, { chouyu_expires_at: -1 }, { chouyu_expires_at: '2026-01-01' }, { chouyu_source_session_id: {} }])('rejects malformed known metadata', metadata => {
    expect(() => remoteMemoryAttributes(metadata, current)).toThrow('属性无效')
  })
})
