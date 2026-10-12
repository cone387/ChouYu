import { expect, it } from 'vitest'
import { extractSkillExamples, skillCapability } from './contact-capabilities'
import type { ContactSkill } from './skills'
const skill: ContactSkill = { id: 'writer', name: 'Writer', description: 'Use the supplied instructions.', digest: 'digest', files: ['SKILL.md'], installedAt: 1, assigned: true, enabled: true, usedBy: ['alice'], compatibility: { scripts: [], dependencyFiles: [], externalRequirements: [], unsupportedFiles: [], assets: [] } }
it('separates instruction readiness from Docker and never invents examples', () => {
  expect(skillCapability(skill, { ready: false, engineReady: false, message: 'Unavailable' })).toMatchObject({ instructionReady: true, scriptReady: false, examples: [] })
  expect(extractSkillExamples('Use the instructions. No examples are included.')).toEqual([])
  expect(extractSkillExamples('# Examples\n- Summarize the supplied meeting notes.\n\n# Requirements\n- An account is required.')).toEqual(['Summarize the supplied meeting notes.'])
})
it('requires enabled instructions, script authorization, actual environment and dependency readiness', () => {
  const withScript = { ...skill, compatibility: { ...skill.compatibility!, scripts: [{ path: 'run.py', runtime: 'python' as const }], dependencyFiles: ['requirements.txt'], externalRequirements: ['Service account'] } }
  const runtime = { ready: true, engineReady: true, message: 'Ready', dependencies: { digest: true } }
  expect(skillCapability(withScript, runtime).scriptReady).toBe(false)
  expect(skillCapability({ ...withScript, scriptsEnabled: true }, { ...runtime, dependencies: {} }).scriptReady).toBe(false)
  const result = skillCapability({ ...withScript, scriptsEnabled: true }, runtime)
  expect(result.scriptReady).toBe(true)
  expect(result.requirements.some(line => line.includes('Service account') && line.includes('未验证'))).toBe(true)
  expect(skillCapability({ ...withScript, scriptsEnabled: true, enabled: false }, runtime).instructionReady).toBe(false)
})
