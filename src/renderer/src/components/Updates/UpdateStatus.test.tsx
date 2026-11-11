import { expect, it } from 'vitest'
import { newestUpdateState, updatePresentation } from './UpdateStatus'

it('keeps a newer ready event when a previously requested snapshot arrives late', () => {
  const ready = { revision: 3, phase: 'ready', version: '1.4.7' } as const
  expect(newestUpdateState(ready, { revision: 1, phase: 'checking' })).toBe(ready)
  expect(newestUpdateState(ready, { revision: 4, phase: 'installing' }).phase).toBe('installing')
})

it('keeps checks and transient check failures quiet while exposing actionable updates', () => {
  expect(updatePresentation({ revision: 1, phase: 'checking' })).toMatchObject({ visible: false, disabled: true })
  expect(updatePresentation({ revision: 2, phase: 'error', errorStage: 'check' })).toMatchObject({ visible: false, action: 'check' })
  expect(updatePresentation({ revision: 3, phase: 'downloading', version: '1.4.7', percent: 44.5 })).toMatchObject({ visible: true, disabled: true, label: '下载 44%' })
  expect(updatePresentation({ revision: 4, phase: 'error', errorStage: 'download', version: '1.4.7' })).toMatchObject({ visible: true, disabled: false, action: 'download' })
  expect(updatePresentation({ revision: 5, phase: 'ready', version: '1.4.7' })).toMatchObject({ visible: true, disabled: false, label: '重启更新', action: 'install' })
})
