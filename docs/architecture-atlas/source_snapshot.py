"""Record an explicitly reviewed Git baseline; detect later source changes.

Regenerating HTML never updates this record. Recording a new baseline is a
separate action after reviewing the diagram content against the selected code.
"""
import argparse
import hashlib
import json
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
SNAPSHOT = ROOT / 'source-snapshot.json'

def digest(data):
    # Git checkout line-ending conversion does not change diagram semantics.
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()

def load_snapshot():
    return json.loads(SNAPSHOT.read_text(encoding='utf-8'))

def source_changes(snapshot, repo=REPO):
    changed = []
    for name, expected in snapshot['sources'].items():
        file = repo / name
        if not file.is_file() or digest(file.read_bytes()) != expected:
            changed.append(name)
    return changed

def record_review(ref, reviewed_at):
    date.fromisoformat(reviewed_at)
    revision = subprocess.check_output(['git', 'rev-parse', '--verify', ref+'^{commit}'], cwd=REPO, text=True).strip()
    manifest = json.loads((ROOT/'atlas-manifest.json').read_text(encoding='utf-8'))
    sources = {}
    for name in sorted({name for diagram in manifest for name in diagram['sources']}):
        committed = subprocess.check_output(['git', 'show', revision+':'+name], cwd=REPO)
        if digest(committed) != digest((REPO/name).read_bytes()):
            raise SystemExit(f'Source differs from {revision[:12]}: {name}. Review a committed baseline first.')
        sources[name] = digest(committed)
    value = {'reviewed_at': reviewed_at, 'reviewed_commit': revision, 'sources': sources}
    SNAPSHOT.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Recorded explicitly reviewed baseline {revision[:12]} ({len(sources)} source files).')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record-review', metavar='GIT_REF', help='Record after reviewing content; does not review diagrams automatically.')
    parser.add_argument('--date', help='Review date YYYY-MM-DD; required with --record-review.')
    args = parser.parse_args()
    if args.record_review:
        if not args.date:
            parser.error('--record-review requires --date')
        record_review(args.record_review, args.date)
    else:
        changed = source_changes(load_snapshot())
        print('Source baseline matches.' if not changed else 'Review required:\n'+'\n'.join(changed))
        raise SystemExit(bool(changed))
