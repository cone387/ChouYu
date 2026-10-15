import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mapProvider } from './provider.mjs';

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
    env, initializeTimeoutMs: 30000, shutdownTimeoutMs: 5000
    , maxTokens: options.maxTokens, requestTimeoutMs: options.requestTimeoutMs
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--probe') {
    const { runProviderProbes } = await import('../../src/main/harness/dsh/fixtures/provider-probe.mjs');
    await runProviderProbes(createHarness);
  } else if (process.argv[2] === '--probe-live') {
    const { runLiveProviderProbe } = await import('../../src/main/harness/dsh/fixtures/provider-probe.mjs');
    await runLiveProviderProbe(createHarness);
  } else throw new Error('No DSH helper command specified.');
}
