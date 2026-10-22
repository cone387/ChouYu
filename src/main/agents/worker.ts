import { WorkLoopHost } from '../agent-space/workloop-host'
import { SkillLibrary } from '../skills/library'
import { dirname, join } from 'node:path'
import { evidenceFromText } from './sources'
import { ContactCommandQueue } from '../agent-space/command-queue'
import { dispatchContactCommand } from '../agent-space/worker-commands'
import { contactStorageDiagnostic, initializeContactStorage } from '../storage/contact-database'
const port = process.parentPort!
let service: WorkLoopHost | undefined
// Only init/close form an exclusive barrier; roster sync fans out per contact.
const messages = new ContactCommandQueue()
port.on('message', event => {
  // Probe the event loop independently of a slow, awaited command.
  if (typeof event.data.ping === 'number') { port.postMessage({ pong: event.data.ping }); return }
  const { requestId, method, id, args } = event.data
  const execute = async () => {
    try {
      let result: unknown
      if (method === 'init') {
        if (!Array.isArray(args) || args.length < 1 || args.length > 2 || typeof args[0] !== 'string' || !args[0].trim()
          || args[1] !== undefined && (!args[1] || typeof args[1] !== 'object' || Array.isArray(args[1]))) throw new Error('联系人初始化参数无效。')
        port.postMessage({ requestId, started: true })
        const smoke = process.env.CHOUYU_SMOKE_TEST === '1' && Boolean(process.env.CHOUYU_SMOKE_USER_DATA)
        service = await initializeContactStorage(() => new WorkLoopHost(args[0], characterId => port.postMessage({ changed: characterId }), undefined, smoke ? async (url) => {
          const fixtures: Record<string, string> = {
            'https://chouyu-agent-smoke.invalid/research': '开发者访谈提出了需求，是否愿意付费需要进一步验证。',
            'https://chouyu-agent-smoke.invalid/counter-evidence': '补充访谈：个人用户不愿意付费，团队管理员可能有预算，需要进一步核对。',
            'https://chouyu-agent-smoke.invalid/team-evidence': '团队管理员访谈：团队已有免费的内部方案，没有替换意愿。该方向暂时缺乏支持。',
            'https://chouyu-agent-smoke.invalid/search-evidence': '新发现的定价页面：个人版免费，团队管理功能收费。付费需求仍需验证。'
          }
          if (!fixtures[url]) throw new Error('Smoke agents cannot access external sources')
          return evidenceFromText(url, '<title>隔离验收资料</title>' + fixtures[url].repeat(10))
        } : undefined, smoke ? async (query, key, signal) => {
          signal.throwIfAborted()
          if (query !== '团队 免费 替代品' || key !== 'search-smoke-secret') throw new Error('Smoke search only accepts its isolated fixture')
          return [{ url: 'https://chouyu-agent-smoke.invalid/search-evidence', title: '新发现的定价页面' }]
        } : undefined, id => new SkillLibrary(join(dirname(args[0]), 'contact-skills')).snapshot(id), join(dirname(args[0]), 'contact-skills'), { dshRuntime: args[1] }), storageRetry => port.postMessage({ requestId, storageRetry }))
      }
      else if (!service) throw new Error('Agent 执行进程尚未初始化。')
      else {
        result = await dispatchContactCommand(messages, service, method, id, args, () => port.postMessage({ requestId, started: true }))
        if (method === 'close') service = undefined
      }
      port.postMessage({ requestId, result })
    } catch (error) {
      if (process.env.CHOUYU_SMOKE_TEST === '1') console.error('Agent RPC failed', method, error)
      port.postMessage({ requestId, error: error instanceof Error ? error.message : 'Agent 操作失败。', storage: contactStorageDiagnostic(error) })
    }
  }
  void (method === 'init' ? messages.submit('', true, execute) : execute()).catch(error => console.error('Agent worker transport failed', error instanceof Error ? error.name : 'Error'))
})
