import { describe, expect, it } from 'vitest'
import { recordingTogglePatch } from './journal-recording'

describe('recording switch', () => {
  it('enables a previously disabled recorder', () => expect(recordingTogglePatch({ enabled: false, paused: false })).toEqual({ enabled: true, paused: false }))
  it('resumes a paused recorder', () => expect(recordingTogglePatch({ enabled: true, paused: true })).toEqual({ enabled: true, paused: false }))
  it('pauses without disabling or clearing capture preferences', () => expect(recordingTogglePatch({ enabled: true, paused: false })).toEqual({ paused: true }))
})
