import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mapProvider } from './provider.mjs';
import { connect } from 'node:net';
import { RpcPeer } from './wire.mjs';

export function createHarness(config, options) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('DSH helper requires Node 24.');
  const mapped = mapProvider(config, { tools: true, images: false });
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, options.env, mapped.env, { CHOUYU_DSH_PROVIDER: JSON.stringify(mapped.profile) });
  return new DeepSeekHarness({
    profile: 'sdk-minimal', provider: 'chouyu', model: config.model.trim(),
    patches: [join(import.meta.dirname, 'profile.yml'), ...(options.patches ?? [])],
    dshHome: options.home, processCwd: import.meta.dirname, cwd: options.home,
    env, initializeTimeoutMs: 30000, shutdownTimeoutMs: 5000,
    maxTokens: options.maxTokens, requestTimeoutMs: options.requestTimeoutMs
  });
}

async function serve() {
  const config = { ...JSON.parse(process.env.CHOUYU_DSH_CONFIG), apiKey: process.env.CHOUYU_DSH_API_KEY };
  const harness = createHarness(config, { home: process.env.CHOUYU_DSH_HOME, env: {
    CHOUYU_DSH_PORT: process.env.CHOUYU_DSH_PORT, CHOUYU_DSH_TOKEN: process.env.CHOUYU_DSH_TOKEN,
    CHOUYU_DSH_WORKDIR: process.env.CHOUYU_DSH_HOME
  } });
  const peer = new RpcPeer(connect(Number(process.env.CHOUYU_DSH_PORT), '127.0.0.1'), async (method, value) => {
    if (method === 'ready') { await harness.start(); return true; }
    if (method === 'close') { await harness.close(); return true; }
    throw new Error('DSH helper 命令无效。');
  }, () => { void harness.close().finally(() => { process.exitCode = 0; }); });
  await peer.request('hello', { role: 'helper', token: process.env.CHOUYU_DSH_TOKEN }, { timeoutMs: 10000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--probe') {
    const { runProviderProbes } = await import('../../src/main/harness/dsh/fixtures/provider-probe.mjs');
    await runProviderProbes(createHarness);
  } else if (process.argv[2] === '--probe-live') {
    const { runLiveProviderProbe } = await import('../../src/main/harness/dsh/fixtures/provider-probe.mjs');
    await runLiveProviderProbe(createHarness);
  } else if (process.argv[2] === '--serve') await serve();
  else throw new Error('No DSH helper command specified.');
}
