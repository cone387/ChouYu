// Reuse the isolated production-app runner with both harnesses and the module audit.
process.argv.push('--agentspace')
require('./contact-soak.cjs')
