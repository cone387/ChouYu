import { expect, it } from 'vitest'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamNativeChat } from '../harness/native/runner'
import { resolveCharacterConfig } from '../../shared/characters'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { ContactTaskStore } from '../task-center/contact-store'
import { WorkStrategyRuntime } from '../workloop/workflow'
import { chapterTail } from './chapter-continuation'

// Opt-in paid provider test. Synthetic prose and temporary SQLite only.
it.skipIf(!process.env.CHOUYU_CHAPTER_MODEL_ACCEPTANCE)('real author model advances an oversized first chapter despite stale nextStep', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!)
  const resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw new Error('阿笔模型配置不可用')
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-chapter-model-'))
  const store = new ContactTaskStore(join(directory, 'agents.db')), runtime = new WorkStrategyRuntime(store, join(directory, 'checkpoints.db'))
  const records: unknown[] = []
  try {
    store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '续写长篇奇幻小说《海上旧塔》。接着既有情节写下去，保持人物设定，不重写开头。', sources: [], dailyCalls: 20 })
    const topicId = store.overview('writer').focusTopicId!
    const beats = ['林音随渔船抵达海岛，寻找父亲留下的旧塔。', '她在潮水退去时发现了塔底封存的石门。', '石门后的守灯人交给她一封被海水浸湿的信。', '她读懂信中约定，知道父亲曾为了守住航线留下。', '夜半风暴袭来，她和守灯人合力修好了塔顶的灯。', '灯火亮起，远处船只平安入港，守灯人将第二封未拆的信交给她。']
    const setting = '盐雾贴着石阶缓缓流动，窗外传来浪拍礁石的声音。林音记得父亲教过的辨星方法，也记得自己答应过母亲要平安归去。塔里的铜铃随海风摆动，低沉的响声穿过曲折的楼梯，落在潮湿的石墙上。'
    for (const [index, beat] of beats.entries()) {
      const runId = store.createRun('writer', '')
      store.finish(runId, { runId, title: '第一章', body: '保存分节', nextStep: '继续第一章下一节', evidence: [], createdAt: Date.now() }, [],
        { judgement: '第一章持续写作中', nextStep: '继续第一章下一节', openQuestions: '', reason: '延续情节', status: 'researching' },
        { completionCriteria: '完成原任务范围内的长篇小说', stages: [{ id: 'draft', title: '小说正文', status: 'active' }], summary: '林音到海岛寻父，与守灯人共同恢复灯塔，船队已经平安归港，现在收到下一封信。', section: { id: `ch1s${index + 1}`, title: `第一章·${index + 1}`, body: `${beat}\n\n${setting.repeat(12)}\n\n${beat}` } })
    }
    const original = store.deliveries.get(topicId)!.sections
    const signal = AbortSignal.timeout(240000)
    let calls = 0
    for (let round = 0; round < 2 && chapterTail(store.deliveries.get(topicId)!.sections)?.number === 1; round++) {
      const run = store.createRun('writer', '')
      await runtime.execute(run, resolved.config.soulMd, async (prompt, runSignal, options) => {
        if (++calls > 10) throw new Error('验收调用达到限定次数')
        let raw = ''
        await streamNativeChat([{ role: 'user', content: prompt }], options?.plainText ? '按要求只输出正文。' : '按要求输出完整 JSON。', { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }, chunk => { raw += chunk; options?.onPartial?.(raw) }, runSignal, undefined, { timeoutMs: 90000, maxOutputTokens: 8192 })
        return raw
      }, signal)
      const row = store.getRun(run)!
      records.push({ status: row.status, error: row.error, chapter: JSON.parse(row.input).chapterContinuation, sections: store.deliveries.get(topicId)!.sections.slice(original.length) })
      expect(row.status, row.error || '本轮应成功保存正文').toBe('completed')
    }
    expect(chapterTail(store.deliveries.get(topicId)!.sections)?.number).toBe(2)
    expect(store.deliveries.get(topicId)!.sections.slice(0, original.length)).toEqual(original)
    expect(store.deliveries.get(topicId)!.sections.at(-1)!.body.length).toBeGreaterThan(100)
  } finally {
    mkdirSync('artifacts', { recursive: true })
    writeFileSync('artifacts/chapter-model-acceptance.json', JSON.stringify({ model: resolved.config.model, records }, null, 2), 'utf8')
    runtime.close(); store.close(); rmSync(directory, { recursive: true, force: true })
  }
}, 250000)
