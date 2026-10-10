import { expect, it } from 'vitest'
import { parseSearchResults, runProcess } from './skillhub'

it('preserves canonical namespace identities from official JSON', () => {
  expect(parseSearchResults(JSON.stringify({ results: [{ slug: '@alice/review', name: 'Review', description: '说明', version: '1.2' }, { slug: '../../bad', name: 'Bad' }] }))).toEqual([{ id: '@alice/review', name: 'Review', description: '说明', version: '1.2' }])
})
it('does not turn a provider failure into an empty result', () => {
  expect(() => parseSearchResults('{"results":[],"warnings":["search request failed"]}')).toThrow(/search request failed/)
  expect(() => parseSearchResults('server offline')).toThrow(/搜索/)
  expect(parseSearchResults('{"results":[]}')).toEqual([])
  expect(parseSearchResults('No skills found.\n')).toEqual([])
})
it('runs argument arrays without a shell and cancels pending processes', async () => {
  const args = 'a & echo unexpected'
  expect(await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', args])).toBe(args)
  const controller = new AbortController()
  const operation = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal })
  controller.abort()
  await expect(operation).rejects.toThrow(/取消/)
})
it('bounds process output', async () => {
  await expect(runProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(2000000))'])).rejects.toThrow(/输出/)
})
