// Isolated end-to-end NSIS install/upgrade/uninstall. Never uses ChouYu's app ID or data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows is required.');
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const work = fs.mkdtempSync(path.join(root, 'artifacts/installer-upgrade-'));
  const product = `ChouYuUpgradeTest${path.basename(work).split('-').at(-1)}`;
  const packageName = product.toLowerCase();
  const installed = path.join(root, 'temp', `iu-${path.basename(work).split('-').at(-1)}`);
  // 41 + NSIS's random directory + old-install + this dependency exceeds MAX_PATH,
  // while the installer's shorter 7z-out extraction path remains below it.
  const fixtureTemp = path.join(root, 'temp', `it-${path.basename(work).split('-').at(-1)}`).padEnd(41, 'x');
  assert.equal(fixtureTemp.length, 41, 'Run this Windows fixture from a shorter checkout path.');
  fs.mkdirSync(fixtureTemp, { recursive: true });
  const payload = path.join(work, 'payload');
  const project = path.join(work, 'project');
  const relative = 'resources/dsh-runtime/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools/models/issues_manager/descriptions/selectElementAccessibilityInteractiveContentAttributesSelectDescendant.md';
  const legacyFile = path.join(payload, relative);
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.mkdirSync(project);
  // A valid PE is sufficient: silent fixtures must never launch the app.
  const regression = fs.readdirSync(path.join(root, 'artifacts')).filter(n => n.startsWith('installer-regression-'))
    .map(n => path.join(root, 'artifacts', n, 'parent.exe')).find(p => fs.existsSync(p));
  assert.ok(regression, 'Run npm run test:installer first.');
  fs.copyFileSync(regression, path.join(payload, `${product}.exe`));
  fs.writeFileSync(legacyFile, 'old dependency remains intact on failed upgrade');
  const dataRoot = path.join(process.env.APPDATA, packageName);
  fs.mkdirSync(dataRoot);
  const data = path.join(dataRoot, 'user-data-sentinel.txt');
  fs.writeFileSync(data, 'preserve user data');
  async function pack(version, fixed) {
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: packageName, version, description: 'Isolated installer regression', author: 'ChouYu' }));
    const output = path.join(work, `${version}-${fixed ? 'fixed' : 'original'}`);
    await build({ projectDir: project, prepackaged: payload, publish: 'never', targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config: {
      appId: `com.chouyu.installer-test.${product}`, productName: product,
      electronVersion: require('electron/package.json').version,
      directories: { output, buildResources: path.join(root, 'resources') },
      win: { signAndEditExecutable: false },
      nsis: { include: fixed ? path.join(root, 'resources/installer.nsh') : path.join(work, 'empty.nsh'),
        oneClick: false, allowToChangeInstallationDirectory: true, runAfterFinish: false,
        createDesktopShortcut: false, createStartMenuShortcut: false, artifactName: 'ChouYu-regression.exe' }
    } });
    return path.join(output, 'ChouYu-regression.exe');
  }
  function run(file, args) {
    const result = spawnSync(file, args, {
      env: { ...process.env, TEMP: fixtureTemp, TMP: fixtureTemp }, windowsHide: true, timeout: 90000
    });
    if (result.error) throw result.error;
    return result.status;
  }
  fs.writeFileSync(path.join(work, 'empty.nsh'), '# Original installer without project hooks\n');
  const old = await pack('1.4.2', false);
  assert.equal(run(old, ['/S', `/D=${installed}`]), 0, 'Old version installation failed');
  assert.equal(fs.readFileSync(path.join(installed, relative), 'utf8'), 'old dependency remains intact on failed upgrade');
  fs.writeFileSync(path.join(payload, 'version.txt'), '1.4.3');
  // Exercise one legacy upgrade removal directly: the full old installer retries
  // this six times and its misleading dialog needlessly slows unattended tests.
  const oldUninstaller = path.join(work, 'legacy-uninstaller.exe');
  fs.copyFileSync(path.join(installed, `Uninstall ${product}.exe`), oldUninstaller);
  assert.notEqual(run(oldUninstaller, ['/S', '/KEEP_APP_DATA', '--updated', `/currentuser`, `_?=${installed}`]), 0,
    'Expected the original upgrade removal to reproduce the long-path failure');
  assert.equal(fs.readFileSync(path.join(installed, relative), 'utf8'), 'old dependency remains intact on failed upgrade');
  const fixed = await pack('1.4.3', true);
  assert.equal(run(fixed, ['/S', `/D=${installed}`]), 0, 'Fixed upgrade failed');
  assert.equal(fs.readFileSync(path.join(installed, 'version.txt'), 'utf8'), '1.4.3');
  assert.equal(fs.readFileSync(data, 'utf8'), 'preserve user data');
  // _?= keeps the process synchronous, as used by electron-builder during upgrades.
  assert.equal(run(path.join(installed, `Uninstall ${product}.exe`), ['/S', `/KEEP_APP_DATA`, `_?=${installed}`]), 0);
  assert.equal(fs.existsSync(path.join(installed, `${product}.exe`)), false);
  assert.equal(fs.readFileSync(data, 'utf8'), 'preserve user data');
  fs.unlinkSync(data);
  fs.rmdirSync(dataRoot);
  console.log(`NSIS install, original failure/rollback, fixed upgrade and uninstall passed: ${work}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
