"""Check generated files, source freshness, links, SVG semantics and layout."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
from html.parser import HTMLParser
import argparse, json, re, subprocess, sys
import xml.etree.ElementTree as ET
from source_snapshot import load_snapshot, source_changes

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--static-only', action='store_true', help='Use only Python standard library; skip browser layout checks.')
parser.add_argument('--browser-executable', type=Path, help='Optional local Chromium/Chrome executable; default: Playwright Chromium.')
parser.add_argument('--output', type=Path, default=ROOT.parent.parent/'artifacts'/'architecture-atlas', help='Browser screenshots and results directory.')
args=parser.parse_args()
OUT=args.output.resolve()
class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs):
        self.links.extend(v for k,v in attrs if k in ('href','src') and v)

subprocess.run([sys.executable,str(ROOT/'build_atlas.py'),'--check'],check=True)
manifest=json.loads((ROOT/'atlas-manifest.json').read_text(encoding='utf-8'))
snapshot=load_snapshot()
issues=[]
declared={name for diagram in manifest for name in diagram['sources']}
if declared!=set(snapshot['sources']):issues.append('Source snapshot and manifest list different sources.')
issues.extend('Source review required: '+name for name in source_changes(snapshot))
expected={'index.html'}|{d['slug']+'.html' for d in manifest}
if expected!={f.name for f in ROOT.glob('*.html')}:issues.append('Unexpected or missing HTML files.')
for file in sorted(ROOT.glob('*.html')):
    content=file.read_text(encoding='utf-8')
    parsed=Links();parsed.feed(content)
    for href in parsed.links:
        u=urlsplit(href)
        if u.scheme or u.netloc:
            issues.append(f'{file.name}: non-local link/resource {href}')
        elif u.path and not (ROOT/unquote(u.path)).is_file():
            issues.append(f'{file.name}: missing link {href}')
        elif u.path.startswith('../../') and unquote(u.path[6:]) not in declared:
            issues.append(f'{file.name}: source link absent from manifest: {href}')
    if re.search(r'@import|url\(\s*[\"\x27]?https?://',content):issues.append(f'{file.name}: external CSS resource')
    blocks=re.findall(r'<svg\b.*?</svg>',content,re.S)
    if len(blocks)!=1:issues.append(f'{file.name}: expected one SVG')
    for block in blocks:
        try:
            svg=ET.fromstring(block)
            ids={e.get('id') for e in svg.iter() if e.get('id')}
            labels=svg.get('aria-labelledby','').split()
            if svg.get('role')!='img' or len(labels)!=2 or not set(labels)<=ids:
                issues.append(f'{file.name}: missing SVG accessible title/description')
            if svg.get('viewBox')!='0 0 1280 720':issues.append(f'{file.name}: unexpected canvas')
            for marker in re.findall(r'url\(#([^)]*)\)',block):
                if marker not in ids:issues.append(f'{file.name}: missing marker {marker}')
        except ET.ParseError as error:
            issues.append(f'{file.name}: invalid SVG: {error}')
if issues:
    raise SystemExit('\n'.join(issues))
print(f'Static checks passed: {len(expected)} pages, {len(declared)} source files.')
if args.static_only:
    raise SystemExit(0)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    raise SystemExit('Browser checks need requirements-qa.txt; see README.md. For standard-library checks use --static-only.')
OUT.mkdir(parents=True,exist_ok=True)

results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':str(args.browser_executable)} if args.browser_executable else {}))
    page=browser.new_page(viewport={'width':1440,'height':1150},device_scale_factor=1)
    page.route('**/*',lambda route:route.continue_() if urlsplit(route.request.url).scheme=='file' else route.abort())
    for file in sorted(ROOT.glob('*.html')):
        parsed=Links();parsed.feed(file.read_text(encoding='utf-8'))
        missing=[]
        for href in parsed.links:
            u=urlsplit(href)
            if not u.scheme and u.path and not (ROOT/unquote(u.path)).is_file():missing.append(href)
        page.goto(file.as_uri(),wait_until='load')
        geometry=page.evaluate('''() => [...document.querySelectorAll('svg')].map(svg=>{
          const nodes=[...svg.querySelectorAll('.node')].map(g=>({g,rect:g.querySelector('rect'),name:g.querySelector('.name')?.textContent}));
          const fit=[], transit=[], masks=[];let offCanvas=[];
          for(const el of svg.querySelectorAll('text')){const b=el.getBBox();if(b.x<0||b.y<0||b.x+b.width>1280||b.y+b.height>720)offCanvas.push(el.textContent)}
          for(const n of nodes){const b=n.rect.getBBox();for(const el of n.g.querySelectorAll('text')){const t=el.getBBox();if(t.x<b.x+7||t.y<b.y+3||t.x+t.width>b.x+b.width-7||t.y+t.height>b.y+b.height-3)fit.push({node:n.name,text:el.textContent})}}
          for(const mask of svg.querySelectorAll('.edge-label rect')){const a=mask.getBBox();for(const n of nodes){const b=n.rect.getBBox();if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)masks.push(n.name)}}
          for(const el of svg.querySelectorAll('path[marker-end]')){let len=el.getTotalLength();for(const n of nodes){const b=n.rect.getBBox();let hits=false;for(let d=3;d<len-3;d+=3){const q=el.getPointAtLength(d);if(q.x>b.x+2&&q.x<b.x+b.width-2&&q.y>b.y+2&&q.y<b.y+b.height-2){hits=true;break}}if(hits)transit.push(n.name)}}
          return {nodeCount:nodes.length,fit,transit,masks,offCanvas};
        })''')
        page.screenshot(path=str(OUT/(file.stem+'-desktop.png')),full_page=True)
        if file.stem!='index':page.locator('svg').screenshot(path=str(OUT/(file.stem+'-diagram.png')))
        page.set_viewport_size({'width':390,'height':844})
        mobile=page.evaluate('''() => ({overflow:document.documentElement.scrollWidth>innerWidth,scrollers:[...document.querySelectorAll('.diagram-container')].map(e=>({scrolls:e.scrollWidth>e.clientWidth,minWidth:getComputedStyle(e.querySelector('svg')).minWidth}))})''')
        page.screenshot(path=str(OUT/(file.stem+'-mobile.png')),full_page=False)
        page.emulate_media(media='print')
        printed=page.evaluate("() => [...document.querySelectorAll('svg')].every(e=>getComputedStyle(e).minWidth==='0px')")
        page.emulate_media(media='screen')
        page.set_viewport_size({'width':1440,'height':1150})
        results.append({'file':file.name,'missingLinks':missing,'geometry':geometry,'mobile':mobile,'printReleased':printed})
    browser.close()

(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
issues=[r for r in results if r['missingLinks'] or r['mobile']['overflow'] or not r['printReleased'] or any(not s['scrolls'] or s['minWidth']!='1280px' for s in r['mobile']['scrollers']) or any(g['fit'] or g['transit'] or g['masks'] or g['offCanvas'] or g['nodeCount']>9 for g in r['geometry'])]
print(json.dumps({'files':len(results),'issues':issues,'screenshots':str(OUT)},ensure_ascii=False,indent=2))
raise SystemExit(bool(issues))
