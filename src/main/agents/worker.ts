import { AgentService } from './service'
import { evidenceFromText } from './sources'
const port = process.parentPort!
let service: AgentService | undefined
// Initialization and mutations are ordered; long-running graph execution is independent.
let messages = Promise.resolve()
port.on('message', event => {
  messages = messages.then(async () => {
    const { requestId, method, id, args } = event.data
    try {
      let result: unknown
      if (method === 'init') {
        const smoke = process.env.CHOUYU_SMOKE_TEST === '1' && Boolean(process.env.CHOUYU_SMOKE_USER_DATA)
        service = new AgentService(args[0], characterId => port.postMessage({ changed: characterId }), undefined, smoke ? async (url) => {
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
        } : undefined)
      }
      else if (!service) throw new Error('Agent 执行进程尚未初始化。')
      else if (method === 'sync') await service.sync(args[0])
      else if (method === 'close') { await service.close(); service = undefined }
      else result = await service.request(method, id, args)
      port.postMessage({ requestId, result })
    } catch (error) { port.postMessage({ requestId, error: error instanceof Error ? error.message : 'Agent 操作失败。' }) }
  })
})
