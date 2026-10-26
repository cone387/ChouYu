import { getCharacter, getConfig, getContactIdentityConversation, getContactIdentityRevision, getContactProfile, getState, contactSearchCredential } from '../database'
import { contactSkillLibrary, getContactSkills } from '../skills'
import { SKILL_TOOLS } from '../skills/tools'
import { MATERIAL_TOOL_NAMES } from '../agents/material-tools'
import { contactConversation } from '../agents/conversation'
import { resolveCharacterConfig, resolveCharacterSoul } from '../../shared/characters'
import type { ContactRecoveryIdentity } from '../../shared/contact-recovery'
import type { ContactIdentity } from '../contact-agent/contracts'

export function contactIdentitySource(recovery: (owner: string) => ContactRecoveryIdentity | undefined) {
  return {
    revision(id: string): string {
      let skills: string
      try { skills = contactSkillLibrary().identityRevision(id) } catch { skills = 'unavailable' }
      return JSON.stringify([getContactIdentityRevision(id), skills, recovery(id)])
    },
    read(id: string): ContactIdentity {
      const character = getCharacter(id)
      if (!character) throw new Error('联系人不存在。')
      const config = getConfig(), resolved = resolveCharacterConfig(character, config), history = getContactIdentityConversation(id)
      let skillsRevision: number | undefined
      try { skillsRevision = contactSkillLibrary().revision(id) } catch { /* Snapshot reports the actual failure. */ }
      return {
        id, name: character.name, soul: resolveCharacterSoul(character, config), conversation: contactConversation(history.messages),
        backgroundHarnessEngine: character.backgroundHarnessEngine ?? 'native', recovery: recovery(id),
        configurationVersions: { profile: getContactProfile(id).revision, skills: skillsRevision, credential: contactSearchCredential(id).revision },
        sessionIds: history.sessionIds, visibleNoticeIds: history.visibleNoticeIds, skillToolsEnabled: config.aiToolsEnabled,
        disabledSkillTools: [...SKILL_TOOLS.map(tool => tool.name), ...MATERIAL_TOOL_NAMES].filter(name => getState(`tool:${name}:enabled`) === 'false'),
        skills: getContactSkills(id), searchKey: getState(`agent-search:${id}:api_key`) || '',
        config: resolved.ok ? { provider: resolved.config.provider, baseUrl: resolved.config.baseUrl, apiKey: resolved.config.apiKey,
          model: resolved.config.model, thinkingDisabledModels: config.thinkingDisabledModels } : null
      }
    }
  }
}
