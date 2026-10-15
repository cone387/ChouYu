import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startMockProvider } from './mock-provider.mjs';

export async function runProviderProbes(createHarness) {
  const results = [];
  for (const provider of ['openai', 'claude']) {
    const dir = await mkdtemp(join(tmpdir(), 'chouyu-dsh-probe-'));
    const mock = await startMockProvider(provider);
    const eventPath = join(dir, 'events.jsonl');
    const patch = join(dir, 'probe.patch.yml');
    await writeFile(patch, JSON.stringify([{ insert: [{ id: 'chouyu-provider-probe', name: resolve(import.meta.dirname, 'probe-plugin.mjs').replaceAll('\\', '/') }] }]));
    let harness;
    try {
      harness = createHarness({ provider, baseUrl: mock.baseUrl, apiKey: 'fixture-key', model: 'custom-model' }, { home: dir, patches: [patch], env: { CHOUYU_DSH_PROBE_EVENTS: eventPath } });
      const result = await harness.run('Use chouyu_fixture with value synthetic, then reply DSH_OK.');
      const events = (await readFile(eventPath, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(result.finalResponse, 'DSH_OK');
      assert.equal(mock.requests.length, 2);
      assert.equal(events.filter(e => e.kind === 'tool').length, 1);
      assert(events.some(e => e.kind === 'stream'));
      assert(JSON.stringify(mock.requests[1].body).includes('fixture-result'));
      assert(mock.requests.every(r => r.body.model === 'custom-model'));
      const first = mock.requests[0];
      assert.equal(new URL(first.path, mock.baseUrl).pathname, provider === 'openai' ? '/v1/chat/completions' : '/v1/messages');
      assert.equal(provider === 'openai' ? first.headers.authorization : first.headers['x-api-key'], provider === 'openai' ? 'Bearer fixture-key' : 'fixture-key');
      const offeredTools = first.body.tools.map(t => t.function?.name ?? t.name);
      assert.deepEqual(offeredTools, ['chouyu_fixture']);
      assert(!JSON.stringify(first.body).includes('software engineer assistant'));
      results.push({ provider, requests: 2, toolExecutions: 1, reply: result.finalResponse, evidence: dir });
    } finally { await harness?.close(); await mock.close(); }
  }
  console.log(JSON.stringify({ passed: true, results }));
  return results;
}

export async function runLiveProviderProbe(createHarness) {
  if (process.env.CHOUYU_DSH_LIVE !== '1') throw new Error('Live probe requires explicit opt-in.');
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG || await readFile(join(process.env.APPDATA, 'chouyu', 'chouyu-data.json'), 'utf8'));
  const config = data.config ?? data;
  const dir = await mkdtemp(join(tmpdir(), 'chouyu-dsh-live-'));
  const eventsPath = join(dir, 'events.jsonl');
  const patch = join(dir, 'probe.patch.yml');
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'chouyu-provider-probe', name: resolve(import.meta.dirname, 'probe-plugin.mjs').replaceAll('\\', '/') }] }]));
  const harness = createHarness(config, { home: dir, patches: [patch], env: { CHOUYU_DSH_PROBE_EVENTS: eventsPath }, maxTokens: 1024, requestTimeoutMs: 120000 });
  try {
    const result = await harness.run('This is a synthetic integration check. Call chouyu_fixture exactly once with value synthetic. Then reply with the exact tool result only. Do not call any other tool.');
    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(JSON.parse);
    const toolExecutions = events.filter(e => e.kind === 'tool').length;
    assert.equal(toolExecutions, 1);
    assert(result.finalResponse.includes('fixture-result'));
    const report = { passed: true, provider: config.provider, model: config.model, toolExecutions, reply: result.finalResponse, evidence: dir };
    await writeFile(join(dir, 'result.json'), JSON.stringify(report));
    console.log(JSON.stringify(report));
  } finally { await harness.close(); }
}
