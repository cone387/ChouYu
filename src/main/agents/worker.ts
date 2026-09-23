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
          if (url !== 'https://chouyu-agent-smoke.invalid/research') throw new Error('Smoke agents cannot access external sources')
          return evidenceFromText(url, '<title>隔离验收资料</title>' + '开发者访谈提出了需求，是否愿意付费需要进一步验证。'.repeat(10))
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
