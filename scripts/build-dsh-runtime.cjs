const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources/dsh-runtime-manifest.json'), 'utf8'));
if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('DSH Windows runtime packaging requires Windows x64; macOS legacy packaging is unchanged.');
const target = manifest.platforms['win32-x64'], cache = path.join(root, 'temp/dsh-node'), output = path.join(root, 'out/dsh-runtime'), runtime = path.join(root, 'runtime/dsh');
function command(file, args, options = {}) { const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true, ...options }); if (result.error)
    throw result.error; if (result.status !== 0)
    throw new Error(`${path.basename(file)} exited ${result.status}`); }
function removeOwned(directory) { const actual = path.resolve(directory); if (![output, cache].some(base => actual === base || actual.startsWith(base + path.sep)))
    throw new Error('Refusing cleanup outside runtime build directories'); fs.rmSync(actual, { recursive: true, force: true }); }
fs.mkdirSync(cache, { recursive: true });
const archive = path.join(cache, target.archive);
if (!fs.existsSync(archive))
    command('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--output', archive, target.url]);
const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
if (digest !== target.sha256)
    throw new Error('Pinned Node archive checksum mismatch; runtime was not packaged.');
const extracted = path.join(cache, `node-v${manifest.nodeVersion}-win-x64`);
if (!fs.existsSync(path.join(extracted, 'node.exe'))) {
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(cache)} -Force`]);
}
const node = path.join(extracted, 'node.exe'), npm = path.join(extracted, 'node_modules/npm/bin/npm-cli.js');
command(node, [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: runtime, env: { ...process.env, PATH: extracted + path.delimiter + process.env.PATH } });
removeOwned(output);
fs.mkdirSync(output, { recursive: true });
for (const file of ['helper.mjs', 'plugin.mjs', 'budget.mjs', 'wire.mjs', 'provider.mjs', 'profile.yml', 'package.json', 'package-lock.json'])
    fs.copyFileSync(path.join(runtime, file), path.join(output, file));
fs.copyFileSync(node, path.join(output, 'node.exe'));
fs.copyFileSync(path.join(extracted, 'LICENSE'), path.join(output, 'NODE-LICENSE'));
fs.cpSync(path.join(runtime, 'node_modules'), path.join(output, 'node_modules'), { recursive: true, dereference: true });
const inventory = [];
function scan(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory())
        scan(file);
    else if (item.isFile())
        inventory.push({ path: path.relative(output, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size });
} }
scan(output);
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ ...manifest, nodeExecutableSha256: crypto.createHash('sha256').update(fs.readFileSync(node)).digest('hex'), files: inventory }, null, 2));
command(path.join(output, 'node.exe'), ['--version']);
console.log(`DSH ${manifest.dshVersion}: ${inventory.length} physical files collected in out/dsh-runtime`);
