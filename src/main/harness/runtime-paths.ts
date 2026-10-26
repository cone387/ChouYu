import { join } from 'node:path'
/** Public host composition port; does not start a runtime or load provider code. */
export function resolveDshRuntimePaths(resourcesPath: string, packaged: boolean) {
  const root = packaged ? join(resourcesPath, 'dsh-runtime') : join(resourcesPath, 'out', 'dsh-runtime')
  return { node: join(root, 'node.exe'), helper: join(root, 'helper.mjs'), profile: join(root, 'profile.yml') }
}
