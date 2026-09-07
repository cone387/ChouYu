import type { AppConfig } from '../../shared/config'
import { fetchProviderModels, streamAIChat } from '../ai'

export async function runProviderAcceptance(config: AppConfig) {
  const checks: Array<{ name: string; passed: boolean; detail: Record<string, unknown> }> = []
  const models = await fetchProviderModels(config)
  checks.push({ name: 'model-list', passed: models.ok && models.configuredModelValid, detail: { ok: models.ok, configuredModelValid: models.configuredModelValid, count: models.models.length, errorCode: models.errorCode } })

  const run = async (name: string, task: () => Promise<Record<string, unknown>>) => {
    try { checks.push({ name, passed: true, detail: await task() }) }
    catch (error) { checks.push({ name, passed: false, detail: { error: error instanceof Error ? error.name : 'unknown' } }) }
    console.log(`${name}: ${checks.at(-1)?.passed ? 'PASS' : 'FAIL'}`)
  }
  await run('stream-completion', async () => {
    let text = '', chunks = 0, done = 0
    await streamAIChat([{ role: 'user', content: '请仅输出 CHOUYU_ACCEPTANCE_OK。' }], 'Follow the user instruction precisely.', config, (chunk, finished) => { text += chunk; if (chunk) chunks++; if (finished) done++ })
    if (!text.includes('CHOUYU_ACCEPTANCE_OK') || chunks < 1 || done !== 1) throw new Error('Invalid completion')
    return { chunks, done, markerMatched: true }
  })
  await run('cancel-active-stream', async () => {
    const controller = new AbortController()
    let chunks = 0, done = 0, aborted = false
    const start = Date.now()
    try {
      await streamAIChat([{ role: 'user', content: '从 1 数到 300，每个数字单独一行，不要省略。' }], 'Follow the user instruction.', config, (chunk, finished) => {
        if (finished) done++
        if (chunk) { chunks++; controller.abort() }
      }, controller.signal)
    } catch (error) { aborted = error instanceof Error && error.name === 'AbortError' }
    if (!aborted || !controller.signal.aborted || chunks < 1 || done !== 0) throw new Error('Cancellation did not propagate')
    return { chunks, done, aborted, elapsedMs: Date.now() - start }
  })
  await run('pure-tool-roundtrip', async () => {
    let calls = 0, text = ''
    await streamAIChat([{ role: 'user', content: '调用 acceptance_echo 工具，text 参数为 CHOUYU_TOOL_OK，然后原样输出工具返回值。' }], 'Use the requested tool before answering.', config, chunk => { text += chunk }, undefined, {
      definitions: [{ name: 'acceptance_echo', displayName: 'Synthetic echo', description: 'Returns the supplied synthetic text. No external effects.', risk: 'safe', source: 'builtin', requiresConfirmation: false, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }],
      execute: async call => {
        if (call.name !== 'acceptance_echo') throw new Error('Unexpected tool')
        const args = JSON.parse(call.arguments)
        if (args.text !== 'CHOUYU_TOOL_OK') throw new Error('Unexpected tool argument')
        calls++
        return args.text
      }
    })
    if (calls !== 1 || !text.includes('CHOUYU_TOOL_OK')) throw new Error('Incomplete tool roundtrip')
    return { calls, resultMatched: true }
  })
  return { checks, passed: checks.every(check => check.passed) }
}
