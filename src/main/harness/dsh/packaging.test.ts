import { expect, it } from 'vitest';
import { resolveDshRuntimePaths, DshRuntimePool } from './runtime';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DEFAULT_APP_CONFIG } from '../../../shared/config';
import { prepareHarnessInput } from '../prepare';
import { startMockProvider } from './fixtures/mock-provider.mjs';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
it.skipIf(!process.env.CHOUYU_DSH_PACKAGED_ROOT)('runs the packaged bridge with its bundled Node and no global Node',async()=>{
    const root=resolve(process.env.CHOUYU_DSH_PACKAGED_ROOT!),home=mkdtempSync(join(tmpdir(),'dsh-packaged-bridge-'));
    const original=process.env.PATH;process.env.PATH=`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
    const pool=new DshRuntimePool({home,node:join(root,'node.exe'),helper:join(root,'helper.mjs')}),mock=await startMockProvider('openai',{tools:false});
    try{
        const input=await prepareHarnessInput({requestId:'packaged',characterId:'c',sessionId:'s',systemPrompt:'fixture',messages:[{role:'user',content:'hello'}]},{config:{...DEFAULT_APP_CONFIG,provider:'openai',baseUrl:mock.baseUrl,apiKey:'fixture',model:'fixture'},signal:new AbortController().signal,assertContext:async()=>{},citationContext:async()=>'',privateContext:'',skillContext:'',communication:''});
        const lease=await pool.acquire(input);expect(await lease.run(input,()=>{})).toMatchObject({state:'completed',text:'DSH_OK'});await lease.release();
    }finally{process.env.PATH=original;await pool.close();await mock.close();rmSync(home,{recursive:true,force:true})}
},60000);
it('copies the SDK closure through the actual electron-builder resource matchers',async()=>{
    const {FileMatcher,copyFiles}=require('app-builder-lib/out/fileMatcher');
    const config=require('js-yaml').load(readFileSync('electron-builder.yml','utf8'));
    const root=mkdtempSync(join(tmpdir(),'dsh-packaging-filter-'));
    const relative='node_modules/@deepseek-ai/dsh-sdk-client/package.json';
    const source=join(root,'out/dsh-runtime',relative);
    mkdirSync(join(source,'..'),{recursive:true});writeFileSync(source,'{"name":"sdk-fixture"}');
    try {
        const matchers=config.win.extraResources.map((entry:any)=>new FileMatcher(join(root,entry.from),join(root,'packaged',entry.to),(s:string)=>s,entry.filter));
        await copyFiles(matchers);
        expect(existsSync(join(root,'packaged/dsh-runtime',relative))).toBe(true);
    }finally{rmSync(root,{recursive:true,force:true})}
});
it('resolves physical bundled resources with spaces without Electron or global Node', () => {
    const root = join('C:', 'Program Files', 'ChouYu', 'resources');
    expect(resolveDshRuntimePaths(root, true)).toEqual({ node: join(root, 'dsh-runtime', 'node.exe'), helper: join(root, 'dsh-runtime', 'helper.mjs'), profile: join(root, 'dsh-runtime', 'profile.yml') });
    expect(resolveDshRuntimePaths(root, true).node).not.toContain('app.asar');
    expect(resolveDshRuntimePaths('workspace', false).node).toBe(join('workspace', 'out', 'dsh-runtime', 'node.exe'));
});
it('reaps the helper and descendant after failed startup', async () => {
    const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-startup-')), helper = join(home, 'broken helper.mjs');
    writeFileSync(helper, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';import {join} from 'node:path';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});writeFileSync(join(process.env.CHOUYU_DSH_HOME,'pids.json'),JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
    const pool = new DshRuntimePool({ home, node: process.execPath, helper, startupTimeoutMs: 500 });
    try {
        await expect(pool.acquire({ config: { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture', model: 'fixture' }, messages: [], configVersion: 'fixture' } as never)).rejects.toThrow(/超时/);
        const folder = readdirSync(home).find(n => /^[a-f0-9]{64}$/.test(n))!;
        const pids = JSON.parse(readFileSync(join(home, folder, 'pids.json'), 'utf8')) as number[];
        for (const pid of pids)
            expect(() => process.kill(pid, 0)).toThrow();
    }
    finally {
        await pool.close();
        rmSync(home, { recursive: true, force: true });
    }
}, 15000);
