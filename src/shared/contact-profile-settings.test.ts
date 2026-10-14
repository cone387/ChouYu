import { expect, it } from 'vitest'
import { createDefaultCharacter } from './characters'
import { DEFAULT_APP_CONFIG } from './config'
import { applyContactProfilePatch, contactProfileSnapshot, validateContactProfilePatch } from './contact-profile-settings'

const character = { ...createDefaultCharacter(1), id: 'writer', name: '作者', builtIn: false, soulMd: '原人设', model: '' }
it('projects effective settings without exposing provider credentials', () => {
  const config = { ...DEFAULT_APP_CONFIG, apiKey: 'SECRET', model: 'configured-model', soulMd: '系统人设' }
  const own = contactProfileSnapshot(character, config)
  expect(own.profile.soulMd).toBe('原人设')
  expect(own.effectiveModel).toBe('configured-model')
  expect(JSON.stringify(own)).not.toContain('SECRET')
  const assistant = contactProfileSnapshot(createDefaultCharacter(1), config)
  expect(assistant.profile).toMatchObject({ soulMd: '系统人设', model: 'configured-model' })
  expect(contactProfileSnapshot(createDefaultCharacter(1), { ...config, soulMd: '新系统人设' }).revision).not.toBe(assistant.revision)
})
it('applies only explicit fields and preserves empty independent persona', () => {
  const snapshot = contactProfileSnapshot(character, DEFAULT_APP_CONFIG)
  expect(applyContactProfilePatch(snapshot, validateContactProfilePatch({ name: '新作者' }))).toMatchObject({ name: '新作者', soulMd: '原人设', model: '' })
  expect(applyContactProfilePatch(snapshot, validateContactProfilePatch({ soulMd: '' })).soulMd).toBe('')
  expect(snapshot.profile.name).toBe('作者')
})
it.each([{}, { name: '' }, { name: '字'.repeat(25) }, { avatar: 'x'.repeat(9) }, { soulMd: 'x'.repeat(50001) }, { model: 'x'.repeat(257) }, { category: 'unknown' }, { builtIn: false }, { model: null }, { providerProfileId: '' }])('rejects invalid profile fields without silently truncating: %j', patch => {
  expect(() => validateContactProfilePatch(patch)).toThrow()
})
it('rejects missing providers and invalid provider/model combinations against the saved snapshot', () => {
  const snapshot = contactProfileSnapshot(character, { ...DEFAULT_APP_CONFIG, providerProfiles: [{ id: 'other', name: '其他', provider: 'openai', baseUrl: 'https://example.org', apiKey: '' }] })
  expect(() => applyContactProfilePatch(snapshot, { providerProfileId: 'missing', model: 'm' })).toThrow('档案')
  expect(() => applyContactProfilePatch(snapshot, { providerProfileId: 'other' })).toThrow('模型')
  expect(applyContactProfilePatch(snapshot, { providerProfileId: 'other', model: 'm' })).toMatchObject({ providerProfileId: 'other', model: 'm' })
  const builtIn = contactProfileSnapshot(createDefaultCharacter(1), DEFAULT_APP_CONFIG)
  expect(() => applyContactProfilePatch(builtIn, { providerProfileId: 'other', model: 'm' })).toThrow()
})
