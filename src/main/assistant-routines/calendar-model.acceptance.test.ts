import { expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requestContactTask } from './gateway'
import { AssistantRoutineService } from './service'
import { ContactTaskDraftStore } from './drafts'
import { ContactTaskStore } from '../task-center/contact-store'
import { streamNativeChat } from '../harness/native/runner'
import { resolveCharacterConfig } from '../../shared/characters'

const cases = [
  ['month-31', 'writer', '每个月31号上午九点写一段灯塔故事，没有31号的月份跳过。', { cadence: 'monthly', monthDay: 31, times: ['09:00'] }],
  ['month-last', 'chouyu', '每个月最后一天晚上八点检查联系人的实际工作并汇报。', { cadence: 'monthly', monthDay: 'last', times: ['20:00'] }],
  ['interval', 'writer', '从2026年10月13日起，每隔3个日历日晚上七点写一段灯塔故事。', { cadence: 'interval', intervalDays: 3, anchorDate: '2026-10-13', times: ['19:00'] }]
] as const

it.skipIf(!process.env.CHOUYU_CALENDAR_ACCEPTANCE).each(cases)('live calendar %s saves the actual interpreted schedule', async (key, owner, message, expected) => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!), resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw Error('验收模型不可用')
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-calendar-live-')), store = new ContactTaskStore(join(directory, 'agents.db'))
  const read = (file: string) => existsSync(join(directory, file)) ? readFileSync(join(directory, file), 'utf8') : ''
  const write = (file: string, text: string) => writeFileSync(join(directory, file), text)
  const service = new AssistantRoutineService({ read: () => read('routines.json'), write: text => write('routines.json', text), readHistory: () => undefined, writeHistory: () => {}, generate: async () => { throw Error('Do not execute during parser acceptance') }, deliver: () => {} })
  const drafts = new ContactTaskDraftStore({ read: () => read('drafts.json'), write: text => write('drafts.json', text) })
  let raw = ''
  try {
    const result = await requestContactTask({ kind: 'create', characterId: owner }, message, {
      routineService: service, drafts, defaultCharacterId: 'chouyu',
      config: () => ({ proactiveReturnAwayMinutes: 10, proactiveRestMinutes: 60, proactiveCooldownMinutes: 60 }),
      saveConfig: () => { throw Error('Unexpected configuration change') },
      agents: async (id, method, args) => {
        if (id !== owner) throw Error('Wrong task owner')
        if (method === 'get') return store.overview(id)
        if (method === 'assignCalendarTopic') return store.assignCalendarTopic(id, args[0], '', args[1] as string)
        throw Error(`Unexpected write ${method}`)
      }
    }, async (instruction, content) => {
      let answer = ''
      await streamNativeChat([{ role: 'user', content }], instruction, { ...data.config, ...resolved.config }, text => { answer += text }, AbortSignal.timeout(60000), undefined, { timeoutMs: 60000, maxOutputTokens: 2000 })
      raw += answer + '\n'; return answer
    })
    expect(result.kind).toBe(owner === 'chouyu' ? 'routine' : 'work-created')
    if (owner === 'chouyu') {
      expect(service.list()).toHaveLength(1)
      expect(service.list()[0]).toMatchObject(expected)
      expect(store.overview('writer').topics).toHaveLength(0)
    } else {
      const tasks = store.overview(owner).topics
      expect(tasks).toHaveLength(1)
      expect(tasks[0].calendar).toMatchObject(expected)
      expect(service.list()).toHaveLength(0)
    }
  } finally {
    mkdirSync('artifacts/contact-next', { recursive: true })
    writeFileSync(`artifacts/contact-next/live-calendar-${key}.json`, JSON.stringify({ message, expected, raw, routines: service.list(), topics: store.overview(owner).topics }, null, 2))
    store.close(); rmSync(directory, { recursive: true, force: true })
  }
}, 65000)
