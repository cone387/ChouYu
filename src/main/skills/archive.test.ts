import { afterEach, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKILLHUB_RUNNER, runProcess } from './skillhub'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('checks archive limits and Windows path hazards before writing any member', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chouyu-skill-archive-')); roots.push(root)
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const script = join(root, 'fixture.py')
  writeFileSync(script, 'import zipfile,sys\ndef fetch_remote_search_results(*args,**kwargs): return []\ndef main():\n with zipfile.ZipFile(sys.argv[1]) as archive: archive.extractall(sys.argv[2])\n')
  for (const [kind, expected] of [['traversal', 'Unsafe'], ['link', 'links'], ['case', 'Duplicate'], ['large', '10 MB'], ['device', 'Unsafe']] as const) {
    const archive = join(root, `${kind}.zip`), output = join(root, kind)
    await runProcess(python, ['-I', '-c', `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED) as z:\n z.writestr('SKILL.md','example')\n kind=sys.argv[2]\n if kind=='traversal': z.writestr('../escaped.txt','bad')\n if kind=='link':\n  i=zipfile.ZipInfo('linked'); i.external_attr=0o120777<<16; z.writestr(i,'target')\n if kind=='case': z.writestr('skill.md','duplicate')\n if kind=='large': z.writestr('large.txt','a'*11000000)\n if kind=='device': z.writestr('CON.txt','device')`, archive, kind])
    await expect(runProcess(python, ['-I', '-c', SKILLHUB_RUNNER, script, archive, output])).rejects.toThrow(expected)
    expect(existsSync(join(output, 'SKILL.md'))).toBe(false)
    expect(existsSync(join(root, 'escaped.txt'))).toBe(false)
  }
}, 20000)
