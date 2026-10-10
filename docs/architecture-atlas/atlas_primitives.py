"""Repository-owned SVG primitives and offline styles for the architecture atlas.

Visual conventions follow Diagram Design; no plugin, external font, browser,
or network is required to generate and read the HTML files.
"""
from html import escape as esc

PAPER = '#f5f5f5'
INK = '#2d3142'
MUTED = '#4f5d75'
ACCENT = '#bf4520'

CSS = '''
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--font-sans:'Geist','Noto Sans SC','Microsoft YaHei',system-ui,sans-serif;--font-serif:'Instrument Serif','Noto Serif SC','SimSun',serif}
html{scroll-behavior:smooth}body{font-family:var(--font-sans);background:#f5f5f5;color:#2d3142;min-height:100vh;padding:44px 36px 72px}main{max-width:1360px;margin:auto;min-width:0}
header{padding:20px 0 32px;border-bottom:1px solid #cfd0d4}h1{font:400 48px/1.3 var(--font-serif);letter-spacing:-.02em;margin:12px 0 16px}h2{font:400 34px/1.4 var(--font-serif);margin:6px 0 10px}p{line-height:1.8}.intro{max-width:820px;color:#4f5d75;font-size:15px}.eyebrow{font:500 11px 'Geist Mono',ui-monospace,monospace;letter-spacing:.18em;color:#4f5d75;margin-bottom:8px}
nav{display:flex;flex-wrap:wrap;gap:10px 24px;padding:24px 0}a{color:#4f5d75;text-underline-offset:5px}nav a{font-size:14px;text-decoration:none;border-bottom:1px solid #bfc0c0;padding:7px 0}a:hover{color:#bf4520}section{padding:48px 0 38px;scroll-margin-top:16px;border-bottom:1px solid #cfd0d4}.diagram-container{width:100%;overflow-x:auto;margin-top:16px}svg{width:100%;min-width:1280px;display:block}.notes{display:grid;grid-template-columns:1.35fr 1fr;gap:36px;margin-top:8px}.notes h3{font-size:14px;margin-bottom:8px}.notes p,.sources{font-size:13px;color:#4f5d75}.sources{margin-top:18px}.sources a{margin-right:16px}.mobile-hint{display:none;color:#4f5d75;font-size:12px}footer{padding-top:28px;color:#4f5d75;font-size:12px}
svg text{font-family:var(--font-sans);fill:#2d3142}svg .name{font-size:16px;font-weight:600}svg .small{font-size:12px;fill:#4f5d75}svg .mono{font:12px 'Geist Mono',Consolas,monospace;fill:#4f5d75}svg .group-title{font-size:14px;font-weight:600}svg .accent-text{fill:#bf4520}svg .caption{font-size:16px;fill:#4f5d75}
@media(max-width:720px){body{padding:24px 16px}h1{font-size:34px}h2{font-size:26px}.notes{grid-template-columns:1fr;gap:18px}.mobile-hint{display:block}section{padding-top:32px}}
@media print{body{padding:0}nav,.mobile-hint{display:none}section{break-before:page;break-inside:avoid}.diagram-container{overflow-x:visible}svg{min-width:0}h1{font-size:36px}}
'''

def t(x, y, text, cls='small', anchor='start', extra=''):
    return f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}" {extra}>{esc(text)}</text>'

def box(x, y, w, h, title, sub='', kind='normal', tag='', radius=6, extra=''):
    fill = {'normal':'#fff','focal':'#f2e8e3','store':'#eaeaec','input':'#e8eaed','optional':PAPER}.get(kind, '#fff')
    stroke = ACCENT if kind == 'focal' else MUTED
    dashed = ' stroke-dasharray="5 4"' if kind == 'optional' else ''
    result = f'<g class="node" {extra}><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"{dashed}/>'
    if tag:
        result += t(x+16, y+22, tag, 'mono')
    result += t(x+16, y+(48 if tag else 34), title, 'name')
    if sub:
        result += t(x+16, y+(70 if tag else 57), sub, 'small')
    return result + '</g>'

def path(d, slug, color=MUTED, dashed=False, arrow=True, extra=''):
    key = 'accent' if color == ACCENT else 'normal'
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6"' + (' stroke-dasharray="5 4"' if dashed else '') + (f' marker-end="url(#{slug}-arrow-{key})"' if arrow else '') + f' {extra}/>'

def label(x, y, text, anchor='middle'):
    w = ((sum(12 if ord(c)>255 else 7.4 for c in text)+19)//4)*4
    left = x-w/2 if anchor == 'middle' else x
    return f'<g class="edge-label"><rect x="{left}" y="{y-15}" width="{w}" height="20" rx="2" fill="{PAPER}"/>' + t(x, y, text, 'small', anchor) + '</g>'

def legend(items):
    result = '<line x1="40" y1="648" x2="1240" y2="648" stroke="#cfd0d4"/>'
    for i, (text, kind) in enumerate(items):
        x = 48+i*360
        if kind == 'accent':
            result += f'<rect x="{x}" y="675" width="16" height="12" rx="2" fill="#f2e8e3" stroke="{ACCENT}"/>'
        elif kind == 'dash':
            result += f'<path d="M{x} 681 h24" stroke="{MUTED}" stroke-dasharray="4 3"/>'
        else:
            result += f'<path d="M{x} 681 h24" stroke="{MUTED}"/>'
        result += t(x+36, 685, text)
    return result

def svg(slug, title, desc, body, attrs=''):
    defs = ''.join(f'<marker id="{slug}-arrow-{key}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="{color}"/></marker>' for key, color in [('normal', MUTED), ('accent', ACCENT)])
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-labelledby="{slug}-title {slug}-desc" {attrs}><title id="{slug}-title">{esc(title)}</title><desc id="{slug}-desc">{esc(desc)}</desc><defs>{defs}</defs><rect width="1280" height="720" fill="{PAPER}"/>{body}</svg>'
