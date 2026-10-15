import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
it.skipIf(process.env.CHOUYU_DSH_LIVE !== '1')('uses the existing real provider with synthetic text and one fixture tool only', async () => {
    const electron = createRequire(import.meta.url)('electron') as string;
    const env: NodeJS.ProcessEnv = { ...process.env, CHOUYU_DSH_PROBE_NODE: process.execPath };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electron, [resolve('src/main/harness/dsh/fixtures/live-launch.cjs')], { timeout: 160000, env });
    const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
    expect(result.passed).toBe(true);
    expect(result.toolExecutions).toBe(1);
    expect(result.reply).toContain('fixture-result');
}, 170000);
