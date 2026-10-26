import { lstat, readdir, rm, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { RunRecord } from './store';
/** Only the pinned JSONL backend's project/session directory for this recorded UUID. */
export async function purgeRunLogs(root: string, run: Pick<RunRecord, 'runtimeGroup' | 'dshSessionId'>): Promise<void> {
    if (!run.runtimeGroup || !run.dshSessionId)
        return;
    if (!/^[a-f0-9]{64}$/.test(run.runtimeGroup) || !/^[A-Za-z0-9_-]{1,128}$/.test(run.dshSessionId))
        throw new Error('执行日志关联路径无效。');
    const base = resolve(root), sessions = join(base, run.runtimeGroup, 'sessions');
    let canonicalBase = base;
    const check = async (path: string) => {
        const actual = await realpath(path), rel = relative(canonicalBase, actual);
        if (rel.startsWith('..') || isAbsolute(rel) || (await lstat(path)).isSymbolicLink())
            throw new Error('执行日志路径越界。');
    };
    try {
        // Windows runner temp paths can use an 8.3 alias. Compare like-for-like
        // canonical paths while still rejecting links at the owned root/targets.
        canonicalBase = await realpath(base);
        if ((await lstat(base)).isSymbolicLink()) throw new Error('执行日志路径越界。');
        await check(sessions);
        for (const project of await readdir(sessions, { withFileTypes: true })) {
            if (!project.isDirectory())
                continue;
            const folder = join(sessions, project.name), target = join(folder, run.dshSessionId);
            await check(folder);
            try {
                await check(target);
                await rm(target, { recursive: true, force: false });
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw error;
            }
        }
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
    }
}
