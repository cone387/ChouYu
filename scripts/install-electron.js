// The default Electron CDN is not reachable on every development network.
// Keep an explicitly configured mirror, while providing a working fallback.
if (!process.env.ELECTRON_MIRROR && !process.env.npm_config_electron_mirror) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
}

require('electron/install')
