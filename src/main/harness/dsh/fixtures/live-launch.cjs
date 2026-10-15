// Test-only launcher: decrypt through Electron, pass only config in memory to Node.
const { app, safeStorage } = require('electron');
const { readFileSync, writeFileSync, mkdtempSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const isolatedData = mkdtempSync(join(tmpdir(), 'chouyu-dsh-live-electron-'));
// Chromium v10 safeStorage ciphertext is tied to the DPAPI-wrapped Local State key.
// Copy only that encrypted key, never plaintext credentials or application history.
if (!process.env.CHOUYU_ACCEPTANCE_CONFIG) {
  const state = JSON.parse(readFileSync(join(process.env.APPDATA, 'chouyu', 'Local State'), 'utf8'));
  writeFileSync(join(isolatedData, 'Local State'), JSON.stringify({ os_crypt: state.os_crypt }));
}
app.setPath('userData', isolatedData);
app.whenReady().then(() => {
  if (process.env.CHOUYU_DSH_LIVE !== '1') throw new Error('Live probe requires opt-in');
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG || readFileSync(join(process.env.APPDATA, 'chouyu', 'chouyu-data.json'), 'utf8'));
  const original = data.config ?? data;
  const apiKey = original.apiKey.startsWith('safe:v1:') ? safeStorage.decryptString(Buffer.from(original.apiKey.slice(8), 'base64')) : original.apiKey;
  const config = { provider: original.provider, baseUrl: original.baseUrl, model: original.model, apiKey };
  const child = spawn(process.env.CHOUYU_DSH_PROBE_NODE, [resolve('runtime/dsh/helper.mjs'), '--probe-live'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CHOUYU_ACCEPTANCE_CONFIG: JSON.stringify({ config }) }
  });
  child.stdout.pipe(process.stdout);
  child.stderr.on('data', data => process.stderr.write(data.toString().split(apiKey).join('[REDACTED]')));
  child.on('error', () => app.exit(1));
  child.on('exit', code => app.exit(code ?? 1));
}).catch(error => { console.error(error.message); app.exit(1); });
