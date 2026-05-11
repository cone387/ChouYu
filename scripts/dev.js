const { execSync } = require('child_process');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

try {
  execSync('npx electron-vite dev', { stdio: 'inherit', env });
} catch (e) {
  process.exit(e.status || 1);
}
