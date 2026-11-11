// Exercises the shipped NSIS hooks with the legacy installer's real Rename operation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');

async function main() {
if (process.platform !== 'win32') throw new Error('This regression requires Windows and NSIS.');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const config = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
const compiler = process.env.MAKENSIS ? { path: process.env.MAKENSIS }
  : await getMakeNsisPath(config.toolsets?.nsis, config.nsis.customNsisBinary);
const work = fs.mkdtempSync(path.join(root, 'artifacts/installer-regression-'));
const temp = path.join(work, 'temporary directory with spaces');
fs.mkdirSync(temp, { recursive: true });
const include = config.nsis.include ? `!include "${path.resolve(root, config.nsis.include)}"` : '';
const relative = 'resources\\dsh-runtime\\node_modules\\@deepseek-ai\\dsh-experimental-inspector\\lib\\devtools\\models\\issues_manager\\descriptions';
const filename = 'selectElementAccessibilityInteractiveContentAttributesSelectDescendant.md';
const source = path.join(work, 'legacy-file.md');
const report = path.join(work, 'result.txt');
function build(name, script) {
  const file = path.join(work, `${name}.nsi`);
  fs.writeFileSync(file, `Unicode true\nName "ChouYu installer regression"\nOutFile "${work}\\${name}.exe"\nRequestExecutionLevel user\nSilentInstall silent\n${script}`);
  const result = spawnSync(compiler.path, ['/V2', file], {
    env: { ...process.env, ...compiler.env }, encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
build('legacy', `Section
ReadEnvStr $1 CHOUYU_INSTALLER_TEST_FAIL
StrCmp $1 "1" failed
InitPluginsDir
CreateDirectory "$PLUGINSDIR\\old-install\\${relative}"
ClearErrors
Rename "${source}" "$PLUGINSDIR\\old-install\\${relative}\\${filename}"
IfErrors failed
FileOpen $0 "${report}" w
FileOpen $1 "$PLUGINSDIR\\old-install\\${relative}\\${filename}" r
FileRead $1 $2
FileClose $1
FileWrite $0 $2
FileClose $0
SetErrorLevel 0
Quit
failed:
SetErrorLevel 73
SectionEnd`);
build('parent', `!include LogicLib.nsh
${include}
Function .onInit
!ifmacrodef preInit
!insertmacro preInit
!endif
FunctionEnd
Section
InitPluginsDir
File /oname=$PLUGINSDIR\\legacy.exe "${work}\\legacy.exe"
ExecWait '"$PLUGINSDIR\\legacy.exe" /S' $R0
!ifmacrodef customInstall
!insertmacro customInstall
!endif
ReadEnvStr $R1 TEMP
ReadEnvStr $R2 TMP
FileOpen $0 "${work}\\environment.txt" w
FileWrite $0 "$R1$\\r$\\n$R2"
FileClose $0
SetErrorLevel $R0
SectionEnd`);
const otherTmp = path.join(work, 'separate TMP');
fs.mkdirSync(otherTmp);
for (const [testTemp, fail] of [[temp, false], [`\\\\?\\${temp}`, false], [temp, true]]) {
  fs.writeFileSync(source, 'legacy file must survive the move');
  const result = spawnSync(path.join(work, 'parent.exe'), ['/S'], {
    env: { ...process.env, TEMP: testTemp, TMP: otherTmp, CHOUYU_INSTALLER_TEST_FAIL: fail ? '1' : '0' },
    windowsHide: true, timeout: 30000
  });
  assert.equal(result.status, fail ? 73 : 0, `Legacy migration unexpected exit ${result.status}; artifacts: ${work}`);
  if (!fail) assert.equal(fs.readFileSync(report, 'utf8'), 'legacy file must survive the move');
  assert.equal(fs.existsSync(source), fail);
  assert.equal(fs.readFileSync(path.join(work, 'environment.txt'), 'utf8'), `${testTemp}\r\n${otherTmp}`);
}
console.log(`NSIS legacy long-path migration, existing prefix, failure exit and environment restoration passed: ${work}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
