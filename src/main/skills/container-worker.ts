/** Trusted supervisor; third-party programs only run inside the constrained container. */
export const CONTAINER_WORKER = String.raw`
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const spec = JSON.parse(process.argv[1]);
setTimeout(() => { process.stderr.write('Skill container deadline exceeded'); process.exit(124); }, Math.min(Number(spec.timeoutMs) || 120000, spec.dependencies ? 600000 : 120000)).unref();
let logged = 0;
function output(chunk) { const text = String(chunk).slice(0, 60000 - logged); logged += text.length; if (text) process.stderr.write(text); }
function command(args) { return new Promise((resolve, reject) => {
  const child = cp.spawn(args[0], args.slice(1), { cwd: spec.cwd, env: process.env });
  child.stdout.on('data', output); child.stderr.on('data', output);
  child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('Command exited with code ' + code)));
}); }
function collect(roots) {
  const files = []; let total = 0, count = 0;
  function visit(root, dir, prefix, depth) {
    if (depth > 24) throw new Error('Output directory too deep');
    for (const name of fs.readdirSync(dir)) {
      if (++count > spec.maxEntries) throw new Error('Too many output files');
      if (!name || /[\\:\x00-\x1f]/.test(name) || name === '..') throw new Error('Unsupported output filename');
      const absolute = path.join(dir, name), stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        if (!spec.dependencies) throw new Error('Output links are not supported');
        const target = fs.readlinkSync(absolute), actual = path.relative(root, fs.realpathSync(absolute));
        if (path.isAbsolute(target) || actual === '..' || actual.startsWith('../') || path.isAbsolute(actual)) throw new Error('Dependency link escapes its package');
        files.push({ path: prefix + path.relative(root, absolute), data: '', link: target }); continue;
      }
      if (stat.isDirectory()) { visit(root, absolute, prefix, depth + 1); continue; }
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > spec.maxFile || (total += stat.size) > spec.maxBytes) throw new Error('Output exceeds file limits');
      files.push({ path: prefix + path.relative(root, absolute), data: fs.readFileSync(absolute).toString('base64') });
    }
  }
  for (const item of roots) visit(item.root, item.root, item.prefix, 0);
  return files;
}
(async () => {
  for (const copy of spec.copies) fs.cpSync(copy.from, copy.to, { recursive: true, dereference: false });
  for (const args of spec.commands) await command(args);
  // Script descendants are still inside the same constrained container. The host validates every exported byte.
  process.stdout.write(JSON.stringify({ files: collect(spec.exports) }));
})().catch(error => { output(error.message); process.exitCode = 1; });
`

export interface ContainerFile { path: string; data: string; link?: string }
export const WORK_LIMIT = 8 * 1024 * 1024
export const DEPENDENCY_LIMIT = 64 * 1024 * 1024

/** Treat the container response as untrusted, even when the supervisor produced it. */
export function exportedFiles(raw: string, dependencies = false): { path: string; data: Buffer; link?: string }[] {
  const parsed = JSON.parse(raw) as { files?: ContainerFile[] }
  if (!Array.isArray(parsed.files) || parsed.files.length > (dependencies ? 12000 : 128)) throw new Error('技能输出文件过多。')
  const seen = new Set<string>(); let total = 0
  return parsed.files.map(file => {
    if (!file || typeof file.path !== 'string' || !file.path || file.path.length > 500 || /[\\:\x00-\x1f]/.test(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error('技能输出路径无效。')
    const key = file.path.toLowerCase()
    if (seen.has(key)) throw new Error('技能输出包含重复路径。')
    seen.add(key)
    if (file.link !== undefined) {
      if (!dependencies || typeof file.link !== 'string' || !file.link || file.link.length > 500 || file.data !== '' || /[\\:\x00-\x1f]/.test(file.link) || file.link.startsWith('/')) throw new Error('依赖链接无效。')
      const stack = file.path.split('/'); stack.pop()
      const root = stack[0]
      if (!['package', 'deps'].includes(root)) throw new Error('依赖链接目录无效。')
      for (const part of file.link.split('/')) {
        if (part === '..') { if (stack.length <= 1) throw new Error('依赖链接越界。'); stack.pop() }
        else if (part !== '.') { if (!part || /[. ]$/.test(part)) throw new Error('依赖链接无效。'); stack.push(part) }
      }
      return { path: file.path, data: Buffer.alloc(0), link: file.link }
    }
    const fileLimit = dependencies ? 16 * 1024 * 1024 : 200000
    if (typeof file.data !== 'string' || file.data.length > Math.ceil(fileLimit / 3) * 4) throw new Error('技能输出编码无效或超过单文件限制。')
    const data = Buffer.from(file.data, 'base64')
    if (data.toString('base64') !== file.data) throw new Error('技能输出编码无效。')
    total += data.length
    if (data.length > (dependencies ? 16 * 1024 * 1024 : 200000) || total > (dependencies ? DEPENDENCY_LIMIT : WORK_LIMIT)) throw new Error('技能输出超出容量限制。')
    return { path: file.path, data }
  })
}

/** Build-time code is fixed by ChouYu; package lifecycle scripts never run in a build. */
export const RESTORE_DEPENDENCY_LINKS = String.raw`
const fs=require('node:fs'), path=require('node:path');
let pending=JSON.parse(fs.readFileSync('/chouyu-links.json','utf8'));
while(pending.length){
  const next=[]; let restored=0;
  for(const link of pending){
    try {
      const root=link.path.startsWith('/skill/')?'/skill':'/deps';
      const parent=fs.realpathSync(path.dirname(link.path)), target=fs.realpathSync(path.resolve(parent,link.target));
      const inside=value=>value===root||value.startsWith(root+'/');
      if(!inside(parent)||!inside(target))throw new Error('Dependency link escapes its package');
      fs.symlinkSync(link.target,link.path); restored++;
    }catch(error){if(error.code==='ENOENT')next.push(link);else throw error}
  }
  if(!restored)throw new Error('Dependency links are missing or cyclic');
  pending=next;
}
fs.unlinkSync('/chouyu-links.json');
`
