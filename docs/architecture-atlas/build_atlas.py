"""Build the offline architecture atlas with Python's standard library."""
from pathlib import Path
from html import escape
import json
import argparse
from atlas_primitives import t, box, path, label, legend, svg, PAPER, INK, MUTED, ACCENT, CSS
from source_snapshot import load_snapshot

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='Check generated files without writing them.')
args=parser.parse_args()
snapshot=load_snapshot()
stamp=f'{snapshot["reviewed_at"]} · Git {snapshot["reviewed_commit"][:12]}'
outdated=[]

def emit(name, content):
    content=content.rstrip()+'\n'
    file=ROOT/name
    if args.check:
        if not file.is_file() or file.read_text(encoding='utf-8')!=content:
            outdated.append(name)
    else:
        file.write_text(content, encoding='utf-8', newline='\n')

CSS+='''
.atlas-title{max-width:1000px}.atlas-title strong{font-weight:400;color:#bf4520}.toc-group{padding:24px 0;border-bottom:1px solid #cfd0d4}.toc-group h2{font:600 18px var(--font-sans);margin-bottom:16px}.toc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 32px}.toc-link{display:flex;gap:14px;padding:14px 0;text-decoration:none;border-top:1px solid #dedee0}.toc-link span{font:12px 'Geist Mono',monospace;color:#bf4520;padding-top:3px}.toc-link b{display:block;font-size:15px;font-weight:500}.toc-link small{display:block;line-height:1.7;font-size:12px;margin-top:5px;color:#4f5d75}.topbar{display:flex;justify-content:space-between;gap:20px;font-size:13px;margin-bottom:32px}.diagram-links{display:flex;flex-wrap:wrap;gap:12px 24px;font-size:13px;padding-top:20px}svg a{cursor:pointer}svg a:hover .node>rect{stroke:#bf4520;stroke-width:2}svg a:focus{outline:2px solid #4f5d75}.coverage{width:100%;border-collapse:collapse;margin:22px 0;font-size:13px;line-height:1.8}.coverage th,.coverage td{text-align:left;vertical-align:top;padding:12px 16px;border-bottom:1px solid #d6d7da}.coverage th{font-weight:500}.stamp{margin:18px 0;color:#4f5d75;font-size:13px}.notice{border-left:2px solid #bf4520;padding-left:16px;margin:18px 0;font-size:14px;max-width:1000px}.module-section{border-bottom:0;padding-top:0}.mini{font:12px var(--font-sans);color:#4f5d75}.sources a{display:inline-block;margin-bottom:6px}.source-block{margin-top:16px}svg .node-name{font-size:16px;font-weight:600}svg .source-label{font:12px 'Geist Mono',Consolas,monospace;fill:#4f5d75}
.sources a{max-width:100%;overflow-wrap:anywhere}.notes>div,.topbar>span{min-width:0;overflow-wrap:anywhere}
@media(max-width:850px){.toc-grid{grid-template-columns:1fr}.coverage{font-size:12px}.coverage th,.coverage td{padding:10px 5px}.topbar{flex-wrap:wrap}}
@media print{.topbar,.diagram-links{display:none}.module-section{break-before:auto}}
'''
diagrams=[]
raw_label=label
def label(x,y,text,anchor='middle'):
    return raw_label(x-4 if anchor=='start' else x,y,text,anchor)

def zone(x,y,w,h,title):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="#f0f0f1" stroke="#c7c9ce" stroke-dasharray="4 4"/>'+t(x+16,y+26,title,'group-title')

def node(x,y,w,title,sub='',detail='',kind='normal',href=None,h=96):
    out=box(x,y,w,h,title,sub,kind)
    if detail: out=out.replace('</g>',t(x+16,y+79,detail,'small')+'</g>')
    if href: out=f'<a href="{escape(href)}" aria-label="查看{escape(title)}">{out}</a>'
    return out

def line(slug,pts,dashed=False):
    """Round a hand-routed orthogonal polyline; endpoints remain exact."""
    d=f'M{pts[0][0]} {pts[0][1]}'
    for i in range(1,len(pts)-1):
        a,b,c=pts[i-1],pts[i],pts[i+1]
        r=min(8,abs(b[0]-a[0]+b[1]-a[1])/2,abs(c[0]-b[0]+c[1]-b[1])/2)
        dx1=0 if a[0]==b[0] else (1 if b[0]>a[0] else -1)
        dy1=0 if a[1]==b[1] else (1 if b[1]>a[1] else -1)
        dx2=0 if b[0]==c[0] else (1 if c[0]>b[0] else -1)
        dy2=0 if b[1]==c[1] else (1 if c[1]>b[1] else -1)
        d+=f' L{b[0]-r*dx1} {b[1]-r*dy1} Q{b[0]} {b[1]} {b[0]+r*dx2} {b[1]+r*dy2}'
    d+=f' L{pts[-1][0]} {pts[-1][1]}'
    return path(d,slug,dashed=dashed)

def note(text):return t(48,616,text,'caption')

def finish(body,focus='橙色：本图重点',dashed='虚线：可选或恢复路径'):
    return body+legend([('实线：主要调用或数据方向','line'),(focus,'accent'),(dashed,'dash')])

def add(slug,group,title,subtitle,body,reading,boundary,sources,related=(),kind='ARCHITECTURE'):
    number=f'{len(diagrams)+1:02}'
    diagrams.append(dict(slug=slug,number=number,group=group,title=title,subtitle=subtitle,body=body,reading=reading,boundary=boundary,sources=sources,related=related,kind=kind))

# 01. A whole-application service projection, deliberately not a process map.
s='system'
b=t(48,40,'功能与依赖总览 · 点击模块展开','group-title')
b+=zone(40,56,1200,144,'交互入口 / Electron Renderer → preload → IPC')
b+=node(64,104,1152,'React 工作区与桌面角色','会话、通讯录、用户待办、活动日志、记忆、设置；系统快捷键与托盘进入同一应用',kind='input',href='frontend.html',h=80)
for x in [144,392,640,888,1136]:b+=line(s,[(x,184),(x,264)])
for x in [144,392,640]:b+=line(s,[(x,360),(x,488)])
b+=line(s,[(840,360),(840,424),(704,424),(704,488)])
b+=line(s,[(1136,360),(1136,488)])
for x,w,title,sub,detail,href in [
 (40,208,'聊天与模型','角色上下文 / 流式回复','模型路由 / 工具调用','chat.html'),
 (288,208,'联系人工作','持续任务 / 助手安排','两类执行服务','contacts.html'),
 (536,208,'用户待办','分组 / 清单 / 自定义视图','日期重复 / 提醒','todos.html'),
 (784,208,'日志与记忆','活动采集 / 检索 / 总结','长期记忆 / 可选同步','journal.html'),
 (1032,208,'扩展与系统','工具 / 插件 / 采集','配置 / 诊断 / 桌面集成','extensions.html')]:
    b+=node(x,264,w,title,sub,detail,'focal' if x==288 else 'normal',href)
b+=node(40,488,704,'本地持久化','会话与配置 JSON；任务、联系人、记忆、日志各自的 SQLite；图片独立文件','按职责持有数据，跨存储投递依赖回执与重试',kind='store',href='storage.html')
b+=node(824,488,416,'配置后使用的外部能力','模型 API、网页搜索、Embedding、Mem0、BBTalk','并非全部默认启用，也不共用一个执行通道',kind='optional',href='settings.html')
b+=finish(note('这是服务职责视图；具体进程位置、网络路径和各模块内部关系在后续图展开。'),dashed='虚线框：可选外部能力')
add(s,'系统全景','ChouYu 系统架构总览','从界面、业务服务到本地数据与外部能力，先建立完整地图。',b,
 ['当前应用是 Electron + React 的本地桌面应用，preload 暴露类型化 API，主进程注册 IPC 与服务。','图中的五个业务块是为阅读而归组；例如日志和记忆并不是同一个服务。','外部能力由对应模块按配置调用，图中仅保留代表性依赖，不表示只有扩展模块能联网。'],
 '以页脚记录的 Git 版本为静态源码快照。旧 architecture.md 的事件总线、3D 渲染等规划没有当作已实现能力加入。',
 ['src/main/index.ts','src/main/ipc.ts','src/preload/index.ts','src/renderer/src/App.tsx','package.json'],['processes','frontend','storage'])

# 02. Actual IPC, utility process and worker-thread placement.
s='processes'
b=zone(40,64,304,520,'Renderer · 沙箱')+zone(416,64,376,520,'Main · Node / Electron')+zone(864,64,376,520,'其他本地执行单元')
b+=line(s,[(192,216),(192,376)])
b+=line(s,[(320,424),(376,424),(376,168),(464,168)])
b+=line(s,[(744,160),(912,160)])
b+=line(s,[(600,216),(600,376)])
b+=line(s,[(744,184),(816,184),(816,424),(912,424)],True)
b+=label(204,300,'桥接 API','start')+label(348,292,'IPC','middle')+label(824,144,'RPC')+label(612,296,'消息传递','start')+label(828,330,'平台相关','start')
b+=node(64,120,256,'React Renderer','界面、会话状态、主动触发','nodeIntegration = false','input','frontend.html')
b+=node(64,376,256,'preload 桥接层','contextBridge / ipcRenderer','contextIsolation = true','normal','../../src/preload/index.ts')
b+=node(464,120,280,'Electron 主进程','窗口、IPC、配置和业务服务','注册服务并转发通知','focal','lifecycle.html')
b+=node(464,376,280,'Journal Worker 线程','journal-worker.js / SQLite','worker_threads，不是独立进程','store','journal.html')
b+=node(912,120,280,'联系人 UtilityProcess','agent-worker.js / AgentService','联系人共用此执行进程','normal','contacts.html')
b+=node(912,376,280,'平台采集 / OCR 辅助','原生采集与识别辅助程序','按平台与功能启动','optional','perception.html')
b+=finish(note('联系人并发不等于每人一个进程；日志 Worker 也不等于独立服务端。'))
add(s,'系统全景','进程、线程与通信边界','把“模块分开”与“真正的执行隔离”区别开。',b,
 ['主窗口禁用 Node 集成并启用沙箱与上下文隔离；Renderer 通过 preload 与主进程通信。','AgentWorkerRPC 管理 utilityProcess 的请求与响应，执行结果再由主进程投递。','JournalService 在主进程持有一个 worker_threads 工作线程，日志数据库操作由 worker 承担。'],
 '不画成微服务集群，也不将可选 JSONL 能力桥接协议声称为已启动的服务。日志辅助窗口及不同平台辅助进程细节合并。',
 ['src/main/index.ts','src/preload/index.ts','src/main/agents/index.ts','src/main/agents/worker-rpc.ts','src/main/journal/service.ts','src/main/journal/activity-helper.ts'],['system','contacts','journal'])

# 03. Containment is clearer than dozens of component-import arrows.
s='frontend'
b=line(s,[(320,128),(496,128)])+line(s,[(784,128),(928,128)])
b+=label(408,112,'挂载面板')+label(856,112,'切换页面')
b+=node(64,80,256,'App 桌面外层','Pet、截图覆盖层、面板状态','窗口位置 / 剪贴板 / 未读','input','perception.html')
b+=node(496,80,288,'ChatPanel 工作区外壳','会话选择、共享面板与工作区','维护当前阅读与交互状态','focal','chat.html')
b+=node(928,80,288,'WorkspaceNav','会话 / 通讯录 / 任务等六页','与 GlobalSearch 共同提供导航','normal','search.html')
b+=zone(40,224,1200,360,'工作区页面 · 包含关系，非顺序执行')
for x,y,title,sub,detail,href in [
 (64,280,'会话','MessageArea / InputArea','工具活动与待处理卡片','chat.html'),
 (496,280,'通讯录','ContactsView / ContactTopics','联系人工作与共用任务详情','contacts.html'),
 (928,280,'用户待办','TasksView / TasksBoard','清单、筛选、排序与单任务编辑','todos.html'),
 (64,448,'活动日志','Journal / 子视图','时间线、事项、收藏与周报','journal.html'),
 (496,448,'长期记忆','Memory 工作区','候选、检索、维护与来源','memory.html'),
 (928,448,'设置','Settings / 各能力 Tab','模型、人设、工具与系统配置','settings.html')]:b+=node(x,y,288,title,sub,detail,href=href)
b+=finish(note('同一个工作区容纳多个功能页面；联系人任务详情继续复用一套公共组件。'),dashed='虚线区域：工作区包含范围')
add(s,'系统全景','前端工作区与模块入口','从 App 到工作区，再到六个主要页面。',b,
 ['上排展示面板外层与导航职责，下排展示工作区包含的六个页面，不是执行流水线。','桌面宠物与采集覆盖层位于 App 外层，业务页面位于 ChatPanel 工作区。','点击下排模块进入相应架构图；页面级的共用状态、搜索与导航不逐个画成节点。'],
 '只覆盖主要用户入口，不逐一列出叶子 React 组件或样式文件；设置中的记忆组件被复用到记忆工作区。',
 ['src/renderer/src/App.tsx','src/renderer/src/components/ChatPanel/ChatPanel.tsx','src/renderer/src/components/Workspace/WorkspaceNav.tsx','src/renderer/src/core/workspace-state.ts'],['chat','contacts','todos','settings'])

# 04. A concrete sequence with one approval-requiring tool call, not every chat.
s='chat'
xs=[176,480,784,1104]
b=''
for x in xs:b+=f'<line x1="{x}" y1="140" x2="{x}" y2="624" stroke="#c4c6cb" stroke-dasharray="4 4"/>'
for x,top,h in [(480,168,424),(784,208,48),(176,296,48),(1104,400,48),(784,504,48)]:b+=f'<rect x="{x-4}" y="{top}" width="8" height="{h}" fill="#e4e5e8" stroke="#4f5d75"/>'
messages=[(0,1,176,'提交会话请求',False),(1,2,208,'上下文 + 工具定义',False),(2,1,256,'返回工具调用',True),(1,0,296,'请求本次授权',True),(0,1,344,'用户确认',False),(1,3,400,'执行已校验调用',False),(3,1,448,'返回实际结果',True),(1,2,504,'追加工具结果',False),(2,1,552,'返回回答片段',True),(1,0,592,'流式展示并保存',True)]
for a,c,y,txt,ret in messages:
    message=line(s,[(xs[a],y),(xs[c],y)],ret)
    if (a,c) == (1,0):message=message.replace(f'url(#{s}-arrow-normal)',f'url(#{s}-arrow-open)')
    b+=message+label((xs[a]+xs[c])/2,y-14,txt)
for x,title,sub in zip(xs,['聊天界面','主进程 AI 编排','模型 Provider','工具执行器'],['会话与用户确认','ai:stream / 上下文','OpenAI / Claude 等协议','工具目录 / 参数校验']):b+=node(x-128,44,256,title,sub,kind='focal' if x==480 else 'normal')
b+=legend([('实线：请求或调用','line'),('虚线：响应 / 事件回传','dash'),('本例包含一次需授权工具调用','accent')])
add(s,'聊天与任务','一次带工具的聊天，经过哪些环节','固定示例：模型提出一个需授权的工具调用，用户同意后继续回答。',b,
 ['Renderer 的 streamChat 通过 IPC 发起请求；主进程校验会话归属并构造可信配置与上下文。','工具名称、参数、启用状态和授权在执行前检查；工具结果参与后续生成。','公共交流规则与角色身份由服务端入口注入，普通流式聊天不再额外调用模型审查每条消息。'],
 '不是每次聊天都会调用工具或询问授权；此图只画一个已同意的调用。记忆检索、停止与失败分支合并在注释中，回传箭头表示通道层响应而非精确网络包。',
 ['src/renderer/src/core/ai-engine.ts','src/main/ipc.ts','src/main/ai.ts','src/main/tools/registry.ts','src/main/tool-approval.ts','src/shared/contact-communication.ts'],['extensions','memory','delivery'],kind='SEQUENCE')

# 05. Contact task adapter boundaries.
s='contacts'
b=line(s,[(336,144),(496,144)])+line(s,[(784,144),(928,144)])+line(s,[(1072,192),(1072,304)])+line(s,[(928,352),(784,352)])+line(s,[(640,400),(640,496)])+line(s,[(496,352),(336,352)])
b+=label(416,130,'一个任务描述')+label(856,130,'按能力分流')+label(1084,256,'普通工作请求','start')+label(856,338,'执行与保存')+label(652,456,'创建持久通知','start')
b+=node(48,96,288,'公共任务 UI','列表卡片、概览、五个标签','新建 / 编辑共用单描述弹窗','input','frontend.html')
b+=node(496,96,288,'任务解析网关','原话 + 补问 + 版本 / 归属','支持才保存，失败保留输入','focal','../../src/main/assistant-routines/gateway.ts')
b+=node(928,96,288,'能力与数据适配','普通工作 / 定时安排 / 职责','不要求用户选择内部任务类型','normal','assistant.html')
b+=node(928,304,288,'联系人执行服务','AgentService / Worker RPC','调度、取消、恢复与进度','normal','scheduling.html')
b+=node(496,304,288,'AgentStore','任务、轮次、历史、版本成果','交付正文从已保存版本读取','store','storage.html')
b+=node(48,304,288,'公共任务呈现适配','contactTaskPresentation','真实能力与真实统计','normal','../../src/renderer/src/components/Contacts/contactTaskPresentation.ts')
b+=node(496,496,288,'公共主动投递','正文 / 来源 / 回执 / 未读','不额外调用模型重写成果','normal','delivery.html')
b+=finish(note('聊天中的任务修改另有结构化路由；保存成功才可声称已修改原任务。'))
add(s,'聊天与任务','联系人任务：入口、适配、执行与呈现','UI 统一、能力差异和执行引擎分别承担什么。',b,
 ['共同页面复用 ContactTaskListCard、ContactTaskOverview、ContactTaskDialog 等组件。','自然语言网关验证能力、归属与版本；普通工作进入联系人服务，助手安排进入各自执行通道。','聊天修改通过 chat-changes 等路由处理；原任务和成果保留，取消旧执行后迟到结果不可覆盖。'],
 '此图画普通联系人任务的主链，定时安排另见第 08 张。内部任务字段不是新增 UI 输入项；不恢复标题、预算等多字段表单。',
 ['src/renderer/src/components/Contacts/ContactTopics.tsx','src/renderer/src/components/Contacts/ContactTaskDialog.tsx','src/renderer/src/components/Contacts/contactTaskPresentation.ts','src/main/assistant-routines/gateway.ts','src/main/agents/chat-changes.ts','src/main/agents/service.ts','docs/contact-task-spec.md'],['runtime','scheduling','assistant','delivery'])

# 06. Exact graph node names, with explicit exceptional branches.
s='runtime'
b=line(s,[(304,168),(464,168)])+line(s,[(752,168),(912,168)])+line(s,[(1056,216),(1056,344)])+line(s,[(912,392),(752,392)])+line(s,[(464,392),(304,392)])
b+=line(s,[(1016,440),(1016,552),(208,552),(208,440)],True)
b+=line(s,[(192,216),(192,280),(512,280)],True)+line(s,[(608,216),(608,240),(608,264)],True)
b+=label(384,154,'需要继续')+label(832,154,'资料可用')+label(1068,284,'校验并评审','start')+label(832,378,'首版且已补充')+label(384,378,'修订后提交')+label(608,538,'无需首版修订，直接提交')
b+=label(400,266,'需要等待')+label(620,246,'等待','start')
b+=node(48,120,256,'选择下一步','choose','规划读取 / 创作 / 等待','normal')
b+=node(464,120,288,'读取资料','read','搜索 / 网页 / 共享成果','normal')
b+=node(912,120,288,'生成正文','write','创作、研究或结构化评审','normal')
b+=node(912,344,288,'核对与必要追问','review','必要时 interrupt 等用户回复','normal')
b+=node(464,344,288,'据回复修订','revise','仅首版且本轮有回复时走此节点','normal')
b+=node(48,344,256,'事务提交','commit','成果、进度与通知一起提交','focal')
b+=node(512,264,224,'等待后结束本轮','deferred → END',kind='optional',h=64)
b+=finish(note('图节点对应 runtime.ts 中的 LangGraph；检查点按 runId 持久化。'))
add(s,'聊天与任务','联系人一轮工作的 LangGraph','把真实图节点、条件分支和持久提交摆到同一张图里。',b,
 ['主链是 choose → read → write → review → commit；首版收到回复时先进入 revise。','choose/read 判定需要等待时可以 deferred 提前结束，不等同于任务目标已经完成。','必要问题通过 LangGraph interrupt 与检查点恢复；commit 才提交正式成果与通知。'],
 '这是编排结构，不表示每个节点都调用一次模型。格式修复、正文恢复、权限检查和 Token 预留位于节点或调用封装内部。',
 ['src/main/agents/runtime.ts','src/main/agents/research.ts','src/main/agents/writing-recovery.ts','src/main/agents/store.ts'],['scheduling','delivery'],kind='FLOWCHART')

# 07. Scheduler overview: current concurrency semantics, not old serial-only docs.
s='scheduling'
b=line(s,[(336,136),(496,136)])+line(s,[(784,136),(928,136)])+line(s,[(1072,184),(1072,304)])+line(s,[(928,352),(784,352)])+line(s,[(496,352),(336,352)])+line(s,[(192,400),(192,504)])+line(s,[(336,552),(784,552),(784,448),(1072,448),(1072,400)],True)
b+=label(416,122,'到期 / 手动触发')+label(856,122,'满足执行边界')+label(1084,248,'有可用名额','start')+label(856,338,'调用前预留')+label(416,338,'落盘 / 释放名额')+label(500,538,'满足恢复条件后再调度')
b+=node(48,88,288,'已安排任务队列','task_schedule / 原始接单顺序','随后按到期时间轮转','input')
b+=node(496,88,288,'任务可执行性','工作时段、按需 / 自动、暂停','任务自身失败退避与下次时间')
b+=node(928,88,288,'联系人并发上限','maxConcurrentTasks，默认 1','同一任务仍按轮次串行','focal')
b+=node(928,304,288,'实际执行名额','已实际启动的执行请求','取消请求未退出前仍占名额')
b+=node(496,304,288,'共享额度与独立预算','联系人每日上限 + 任务累计','每次调用预留 Token，结束结算','store')
b+=node(48,304,288,'提交或记录失败','每个任务独立保存退避','一项成功不清空另一项失败','store')
b+=node(48,504,288,'等待 / 回复 / 恢复','等待回复不占实际执行名额','供应商故障按规则低频重试','optional')
b+=finish(note('提高上限可补位；降低上限保留当前轮次；未安排的历史任务不会自行复活。'))
add(s,'聊天与任务','并发、调度与资源边界','当前工作区已支持联系人内配置多任务并发，同一任务保持串行。',b,
 ['工作名额按联系人管理；等待回复、下次执行时间与无法恢复的额度阻塞不占实际执行槽。','启动、修订、继续和回复恢复共用限制；取消请求实际退出前不释放名额，防止同一任务重叠。','失败计数与恢复时间按任务持久化；调用和 Token 仍共享联系人每日额度，累计预算按任务核算。'],
 '这些是当前源码和产品规范描述的控制逻辑，本图不是并发压测报告。供应商余额、网络等故障与格式/权限失败的恢复策略不同，具体阈值见规范。',
 ['src/main/agents/service.ts','src/main/agents/store.ts','src/main/agents/task-failures.ts','src/main/agents/token-budget.ts','src/shared/work-settings.ts','docs/contact-task-spec.md'],['runtime','contacts','delivery'])

# 08. Assistant schedules and companionship converge only at checked delivery.
s='assistant'
b=line(s,[(336,144),(496,144)])+line(s,[(336,392),(496,392)])+line(s,[(784,144),(848,144),(848,240),(928,240)])+line(s,[(784,392),(872,392),(872,272),(928,272)])+line(s,[(1072,320),(1072,480)])+line(s,[(928,528),(784,528)])
b+=label(416,130,'到点触发')+label(416,378,'问候 / 回来')+label(1084,408,'有真实依据','start')+label(856,514,'持久投递')
b+=node(48,96,288,'自然语言长期安排','网关解析目标、时间与周期','保存后计算 nextAt','input')
b+=node(496,96,288,'AssistantRoutineService','安排开关 / 执行历史 / 取消','reminder 或 contact-summary','normal')
b+=node(48,344,288,'主动陪伴触发','proactiveEngine / 空闲状态','每日问候、回来、休息条件','input','lifecycle.html')
b+=node(496,344,288,'CompanionBriefing','问候与回来共用工作检查','休息提示仍按条件文案','normal')
b+=node(928,224,288,'检查联系人真实工作','inspectContactWork / 成果读取','只读，不代替用户处理别人任务','focal')
b+=node(928,480,288,'整理或生成提醒','模型汇总 + 有界事实回退','普通提醒不强制走工作检查','normal')
b+=node(496,480,288,'ChouYu 联系人消息','原始事件回执 / 任务来源','历史定位 / 未读闪烁','normal','delivery.html')
b+=finish(note('上图突出工作检查路径；普通定时提醒与休息文案可直接进入投递。'))
add(s,'聊天与任务','ChouYu 的安排、问候与晨报','定时安排和主动陪伴如何引用真实工作，并进入共同聊天体验。',b,
 ['长期安排由 AssistantRoutineService 保存和调度；问候、回来检查由 CompanionBriefing 维护变化基线与回执。','工作检查只读联系人真实任务、成果和待处理事项；不能把聊天承诺当进展，不能自动代答。','晨报与检查消息经公共投递进入 ChouYu；普通提醒可直接生成文案，不要求每次都调模型。'],
 '提醒、工作检查不是同一条固定流水线。已支持的周期与缺口以任务规范为准；不声称退出或休眠期间仍在运行。',
 ['src/main/assistant-routines/index.ts','src/main/assistant-routines/service.ts','src/main/assistant-routines/companion.ts','src/renderer/src/core/proactive.ts','src/shared/assistant-duties.ts'],['contacts','delivery','lifecycle'])

# 09. User todos are deliberately a different domain.
s='todos'
b=line(s,[(336,144),(496,144)])+line(s,[(784,144),(928,144)])+line(s,[(1072,192),(1072,328)])+line(s,[(928,376),(784,376)])+line(s,[(496,376),(336,376)])+line(s,[(192,424),(192,504)])
b+=label(416,130,'保存单项')+label(856,130,'检查规则')+label(1084,272,'日期到期','start')+label(856,362,'检查提醒')+label(416,362,'先落消息与回执')
b+=node(48,96,288,'用户待办界面','分组 / 清单 / 筛选 / 排序','自定义视图保存工具栏条件','input')
b+=node(496,96,288,'TasksStore','任务、子项、视图、回收站','SQLite / tasks.db','store','storage.html')
b+=node(928,96,288,'TaskScheduler','启动与约每 30 秒检查','恢复时分批补齐日期实例')
b+=node(928,328,288,'按日期生成独立各期','上期未完成，下一期照常生成','生成标记与新任务同事务','focal')
b+=node(496,328,288,'认领到期提醒','完成 / 删除 / 归档不发送','任务 / 子项提醒与去重')
b+=node(48,328,288,'ChouYu 提醒消息','实际消息与回执先保存','再提交认领记录','normal','delivery.html')
b+=node(48,504,288,'系统通知与任务定位','通知开关 / 托盘与未读','恢复积压提醒合并提示','normal','lifecycle.html')
b+=t(496,510,'另一条规则：按完成时间','group-title')+t(496,542,'只有用户明确选择时，从实际完成时间生成下一期。','small')
b+=finish(note('用户待办 ≠ 联系人执行任务：数据模型、重复规则和编辑界面各自独立。'))
add(s,'聊天与任务','用户待办：重复生成与提醒送达','任务列表背后的持久化、日期生成和通知链。',b,
 ['TasksStore 管理用户自己的待办；日程生成独立各期，不依赖完成上一期。','调度器先生成需要的实例，再认领到期提醒；消息回执先持久化，SQL 认领才提交。','新建、编辑、分组和视图继续用弹窗和现有控件；无快速新建、多选或批量处理。'],
 '本图聚焦按日期重复；按完成时间规则由完成操作驱动。应用离线期间不执行，恢复后实例补齐和提醒合并是两个不同操作。',
 ['src/main/tasks/index.ts','src/main/tasks/store.ts','src/main/tasks/scheduler.ts','src/shared/taskScheduling.ts','src/renderer/src/components/Tasks/TasksView.tsx','docs/task-scheduling.md'],['delivery','storage','frontend'])

# 10. Durable delivery, no fictional distributed transaction.
s='delivery'
b=line(s,[(336,144),(496,144)])+line(s,[(784,144),(928,144)])+line(s,[(1072,192),(1072,328)])+line(s,[(928,376),(784,376)])+line(s,[(496,376),(336,376)])+line(s,[(640,424),(640,504)])
b+=label(416,130,'同一事务')+label(856,130,'读取待投递')+label(1084,270,'先校验来源','start')+label(856,362,'写入成功')+label(416,362,'确认发件箱')
b+=node(48,96,288,'正式成果版本','AgentStore.finish / 分节正文','与本轮进度一并保存','store')
b+=node(496,96,288,'持久通知快照','AgentNotices / SQLite','同事务保存待投递正文','focal')
b+=node(928,96,288,'主进程投递器','读取通知并校验任务归属','失败仍保留待投递通知')
b+=node(928,328,288,'appendContactMessage','联系人 / 用途 / 来源 / 回执','拒绝空白、超长和来源错配')
b+=node(496,328,288,'会话与去重回执','chouyu-data.json','保存消息和稳定消息 ID','store','storage.html')
b+=node(48,328,288,'已投递确认','重试依回执去重','清空历史不让旧通知复活')
b+=node(496,504,288,'用户可见消息','正文可读 / 来源可定位','未读提示与托盘闪烁','input','lifecycle.html')
b+=t(48,514,'正文来源：已保存成果','group-title')+t(48,546,'投递不再调用模型改写。','small')+t(48,570,'后续修订不能覆盖旧快照。','small')
b+=finish(note('SQLite 与会话 JSON 不是同一数据库事务；可靠送达依靠通知快照、回执和重试。'))
add(s,'聊天与任务','成果如何可靠地进入聊天','从成果事务到发件箱、会话回执，再到未读状态。',b,
 ['成果版本与任务通知快照在 AgentStore 的同一 SQLite 事务内创建；事务失败不能提前交付。','主进程 appendAgentNotice 与 appendAssistantMessage 适配到同一持久投递函数。','跨 SQLite 和 JSON 的重试用稳定回执去重；读消息与处理交互事项是两种状态。'],
 '图中主链是任务成果交付；提醒和问候从自己的持久回执接入公共投递。普通聊天沿用流式会话保存，不套用任务发件箱。',
 ['src/main/agents/store.ts','src/main/agents/notices.ts','src/main/agents/index.ts','src/main/database.ts','src/shared/contact-communication.ts','src/main/agents/interactions.ts'],['runtime','assistant','storage'])

# 11. Recording and derived knowledge are separate branches.
s='journal'
b=line(s,[(336,144),(496,144)])+line(s,[(784,144),(928,144)])+line(s,[(1072,192),(1072,328)])+line(s,[(928,376),(784,376)])+line(s,[(640,424),(640,504)])+line(s,[(496,376),(336,376)])
b+=label(416,130,'前台窗口 / 时间')+label(856,130,'采集与队列')+label(1084,268,'消息传递','start')+label(856,362,'证据检索')+label(652,470,'按需生成','start')
b+=node(48,96,288,'本地活动来源','ActivityHelper / 系统空闲','前台应用、窗口标题与时间','input','perception.html')
b+=node(496,96,288,'JournalService','定时采样 / 暂停 / 恢复','协调抓图、OCR 与存储配额')
b+=node(928,96,288,'画面采集 + OCR','平台采集 / 本地文字识别','重复画面与资源清理')
b+=node(928,328,288,'Journal Worker 存储','journal.db + media/*.jpg','活动、画面、OCR 与派生记录','store','storage.html')
b+=node(496,328,288,'证据检索与语义索引','按时间 / 应用 / 关键词查证','可选语义检索与缓存','focal')
b+=node(48,328,288,'活动工作区','日视图、画面与事项定位','保留来源，不凭空补日志','input')
b+=node(496,504,288,'整理与复用','总结 / 问答 / 周报 / 项目','收藏、续写与工作手册')
b+=finish(note('采集在本地进行；调用模型或向量能力时，依据所选 Provider 与功能配置。'))
add(s,'功能模块','工作日志：从真实活动到可追溯整理','采集、存储、检索、总结和工作资料复用的主要路径。',b,
 ['JournalService 协调活动辅助程序、采集和 OCR；worker 处理数据库与媒体文件，避免把所有数据库操作放在界面。','证据、语义检索和缓存为日问答与总结提供依据；周报、项目、收藏和手册是派生组织功能。','日志的候选事项和用户待办是不同的数据对象，转入用户待办需要明确操作。'],
 '屏幕采集受平台权限、暂停和配额限制。本图没有运行采集或上传任何画面；细分的 journal 子模块在页面覆盖表中列出。',
 ['src/main/journal/service.ts','src/main/journal/journal-worker.ts','src/main/journal/summary.ts','src/main/journal/semantic-search.ts','src/main/journal/weekly.ts','src/main/journal/projects.ts','src/main/journal/playbook.ts','src/main/journal/saved.ts'],['processes','perception','memory','storage'])

# 12. Memory engine is replaceable; sync is an explicit option.
s='memory'
b=line(s,[(336,144),(496,144)])+line(s,[(784,144),(928,144)])+line(s,[(1072,192),(1072,328)])+line(s,[(928,376),(784,376)])+line(s,[(496,376),(336,376)])+line(s,[(1216,144),(1232,144),(1232,552),(1216,552)],True)
b+=label(416,130,'提取或手动候选')+label(856,130,'确认 / 冲突处理')+label(1084,266,'检索已有记录','start')+label(856,362,'混合排序')+label(416,362,'选择相关内容')+label(1168,466,'显式同步')
b+=node(48,96,288,'记忆输入与候选','对话来源 / 手动记忆 / 导入','保留原始来源与候选状态','input')
b+=node(496,96,288,'MemoryService','确认、冲突、版本、期限','维护、主题聚类与容量控制','focal')
b+=node(928,96,288,'MemoryProvider','本地 SQLite 或所选远程引擎','本地能力始终有回退路径','store')
b+=node(928,328,288,'检索与可选向量','关键词 + Embedding','按当前连接与引擎配置')
b+=node(496,328,288,'相关记忆压缩','排序 / 去重 / 主题摘要','控制上下文占用')
b+=node(48,328,288,'注入聊天上下文','保留记忆引用与反馈','人设与公共交流规则分别处理','normal','chat.html')
b+=node(928,504,288,'Mem0 同步适配','上传 / 拉取预览','不等于所有记忆默认上传','optional')
b+=finish(note('长期记忆库与联系人工作引擎的独立 memories 表是两套数据，不混用身份。'))
add(s,'功能模块','长期记忆：确认、检索与可选同步','从候选到生效，再到相关上下文与来源反馈。',b,
 ['MemoryService 负责候选、冲突决策、版本恢复、主题与维护，Provider 承担具体存储和检索。','能力注册表选择 SQLite 或 Mem0 引擎；Embedding 与同步分别配置。','只有相关记忆进入上下文；聊天中可追溯引用，联系人 Agent 的工作记忆另存于 agents.db。'],
 '是否联网取决于当前引擎、Embedding 与同步配置。本图不读取个人记忆内容，也不声称当前已启用远程服务。',
 ['src/main/memory/service.ts','src/main/memory/provider.ts','src/main/memory/sqlite-provider.ts','src/main/memory/mem0-provider.ts','src/main/memory/sync/mem0-adapter.ts','src/main/capabilities/builtins.ts'],['chat','extensions','storage'])

# 13. Two extension systems, not a single universal plugin bus.
s='extensions'
b=zone(40,72,560,496,'AI 工具与应用插件')+zone(680,72,560,496,'服务能力注册表')
b+=line(s,[(320,208),(320,304)])+line(s,[(320,400),(320,464)])+line(s,[(960,208),(960,304)])+line(s,[(960,400),(960,464)],True)
b+=label(332,264,'元数据适配','start')+label(332,440,'校验后执行','start')+label(972,264,'选择实现','start')+label(972,440,'按配置启用','start')
b+=node(104,112,432,'PluginRegistry','内置注册列表 / 命令 / 认证与执行','当前列表包含 BBTalk')
b+=node(104,304,432,'统一 AI 工具目录','内置工具 + 插件工具适配','逐工具开关、参数与授权','focal','chat.html')
b+=node(104,464,432,'实际工具或插件动作','执行结果返回模型与活动时间线','不把所有工具都当无风险读取',h=88)
b+=node(744,112,432,'CapabilityRegistry','memory engine / embedding / sync','服务实现的注册与能力发现')
b+=node(744,304,432,'内置能力实现','SQLite / Mem0 / OpenAI Embedding','各自的初始化、配置与诊断','normal','memory.html')
b+=node(744,464,432,'可选进程桥接协议','JSONL manifest / transport','存在协议代码，不表示默认已接入','optional',h=88)
b+=finish(note('“应用插件”和“服务能力”是两种扩展方式，不是任意安装包都能热加载。'))
add(s,'功能模块','工具、应用插件与服务能力','把三种容易混淆的扩展职责分开。',b,
 ['PluginRegistry 当前通过源码中的列表注册插件，并提供命令、认证和调用入口。','plugin-tools 将插件适配成 AI 工具定义；实际工具执行经过参数、开关和按需授权检查。','CapabilityRegistry 用于选择记忆引擎、Embedding 和同步能力；进程桥接协议是另一个可选边界。'],
 '图中不是插件市场或动态热加载承诺。这里的 ChouYu 应用插件与本次用来画图的 diagram-design 插件也不是同一运行系统。',
 ['src/main/plugins/registry.ts','src/main/tools/plugin-tools.ts','src/main/tools/registry.ts','src/main/capabilities/registry.ts','src/main/capabilities/builtins.ts','src/main/capabilities/process-bridge.ts','src/main/capabilities/process-transport.ts'],['chat','memory','settings'])

# 14. Native inputs converge on attachments and journal, with separate permissions.
s='perception'
b=line(s,[(336,144),(496,144)])+line(s,[(784,144),(928,144)])+line(s,[(1072,192),(1072,328)])+line(s,[(928,376),(784,376)])+line(s,[(496,376),(336,376)])
b+=line(s,[(192,424),(192,504)])+line(s,[(784,552),(1240,552),(1240,400),(1216,400)],True)
b+=label(416,130,'选择捕获源')+label(856,130,'原始图像')+label(1084,266,'作为附件','start')+label(856,362,'明确发送')+label(416,362,'视觉模型 / 文本')
b+=node(48,96,288,'截图与窗口选择','ScreenCapture / CapturePicker','框选、窗口、屏幕或滚动截图','input')
b+=node(496,96,288,'主进程系统采集','desktopCapturer / 原生辅助','隐藏自身窗口、校验捕获区域')
b+=node(928,96,288,'图像与离线 OCR','原图 / 拼接 / 可选文字识别','本地 OCR 能力依平台支持')
b+=node(928,328,288,'输入区附件','预览图片、拖入文件与文字','用户确认内容后发送','focal')
b+=node(496,328,288,'会话请求','图片 + 正文 / 提取文字','校验模型是否支持视觉','normal','chat.html')
b+=node(48,328,288,'回复与持久引用','图片独立保存，不塞满 JSON','会话只保存附件引用','store','storage.html')
b+=node(48,504,288,'AttachmentStore','数据 URL → 文件与稳定引用','损坏与容量边界单独处理','store')
b+=node(496,504,288,'剪贴板感知','开启后监听文本变化','默认关闭；来源可送到输入区','optional')
b+=finish(note('工作日志的周期采集由 JournalService 独立控制；不会把手动截图自动当作日志。'))
add(s,'功能模块','屏幕、OCR、附件与剪贴板','哪些系统输入留在本地，哪些在用户发送后成为模型输入。',b,
 ['截图入口在 Renderer，捕获源枚举、区域校验和实际采集在主进程与平台辅助层。','图像可作为附件发给视觉模型，支持的平台也可先进行离线 OCR。','AttachmentStore 将图片落成独立文件；剪贴板监听受配置开关控制，默认关闭。'],
 '剪贴板作为独立、可选的输入来源汇入输入区，不由模型请求触发监听。周期性日志采集在日志图单独展开。',
 ['src/main/ipc.ts','src/main/scrolling-capture.ts','src/main/offline-ocr.ts','src/main/attachment-store.ts','src/main/clipboard.ts','src/renderer/src/components/ScreenCapture/ScreenCapture.tsx'],['chat','journal','storage'])

# 15. Storage ownership map, no arrow soup and no invented shared SQL database.
s='storage'
b=t(48,44,'存储所有权 · 相同根目录不代表相同事务','group-title')
stores=[(48,96,368,'应用会话与配置','chouyu-data.json','配置 / 联系人 / 会话 / 状态回执','database.ts'),(456,96,368,'联系人工作与恢复','contact-agents/agents.db','contact-agents/checkpoints.db','AgentStore / LangGraph'),(864,96,368,'用户待办','tasks.db','任务 / 清单 / 视图 / 重复标记','TasksStore'),(48,320,368,'长期记忆','chouyu-memory.db','本地记忆、候选与关联索引','MemoryProvider'),(456,320,368,'活动日志','journal/journal.db','journal/media/*.jpg','Journal Worker'),(864,320,368,'会话图片附件','attachments/','稳定引用与独立媒体文件','AttachmentStore')]
for x,y,w,title,a,c,owner in stores:
    b+=node(x,y,w,title,a,c,'focal' if x==456 and y==96 else 'store')+t(x+16,y+126,owner,'mono')
b+=t(48,520,'凭据保护','group-title')+t(48,552,'API Key / Token 使用 Electron safeStorage；不能据此声称整库已加密。','small')
b+=t(704,520,'恢复与一致性','group-title')+t(704,552,'JSON 写入备份 / 错误状态；SQLite 事务 / WAL / 检查点。','small')
b+=finish(note('所有路径相对 app.getPath("userData")；不展示本机用户的实际数据或凭据。'),dashed='各模块持有自己的恢复机制')
add(s,'数据与基础设施','数据分别存在哪里，由谁负责','应用不是一个大 SQLite：会话、任务、联系人、记忆和日志各有存储边界。',b,
 ['database.ts 实际管理 JSON 会话与配置；文件名不能误导成全应用的 SQLite 层。','联系人任务数据与 LangGraph 检查点分别持久化；工作日志的图像和会话图片也是不同目录。','同库操作可用事务；跨 SQLite 与 JSON 的交付必须依赖回执协议，不画成一个全局原子事务。'],
 '图是存储目录与所有权地图，不暗示所有库具有相同备份策略或整库加密。字段级凭据保护与普通正文落盘分别说明。',
 ['src/main/database.ts','src/main/store-file.ts','src/main/agents/service.ts','src/main/agents/store.ts','src/main/capabilities/builtins.ts','src/main/tasks/index.ts','src/main/journal/journal-worker.ts','src/main/attachment-store.ts'],['delivery','memory','journal'])

# 16. Search federation is a fan-out + result assembly, not a unified index.
s='search'
b=node(48,72,1184,'GlobalSearch：查询 + 范围 + 日期 / 应用过滤','防抖后分别请求对应模块；保留搜索快照和来源定位','','focal',h=80)
centers=[164,400,640,880,1116]
for x in centers:b+=line(s,[(x,152),(x,280)])+line(s,[(x,376),(x,496)])
for x,title,sub,href in [(48,'会话','searchSessions / 正文匹配','chat.html'),(284,'长期记忆','memory.list / active','memory.html'),(524,'工作日志','活动 + captures / OCR','journal.html'),(764,'联系人','角色名称 / 人设匹配','contacts.html'),(1000,'用户待办','未完成 + 已完成查询','todos.html')]:b+=node(x,280,232,title,sub,href=href)
b+=node(48,496,1184,'按来源合并结果，点击回到原位置','Promise.allSettled：某类失败仍保留其他结果，并显示缺失范围','不是将所有模块复制进一个全局搜索数据库','input',h=96)
b+=finish(note('全局搜索的 UI 查询路径，与模型使用的记忆 / 日志语义检索不是同一机制。'))
add(s,'功能模块','全局搜索：并行查询，按来源定位','搜索入口如何连接五类资料，并处理部分服务失败。',b,
 ['GlobalSearch 并行请求会话、记忆、活动与画面、联系人以及任务。','使用 Promise.allSettled 汇总，失败类别明确提示；日志结果有日期、应用和分页覆盖范围。','结果携带对应 ID，回到原会话、任务、联系人或日志证据，而不是复制一份资料。'],
 '这是当前前端聚合搜索；不声称已有单一跨域向量库或完整全文索引。活动和 OCR 在 UI 上同组，实际是两路查询。',
 ['src/renderer/src/components/Workspace/GlobalSearch.tsx','src/renderer/src/core/journal-search.ts','src/shared/conversation-search.ts','src/main/database.ts'],['frontend','memory','journal'])

# 17. Settings control plane, separate model/embedding and role identity.
s='settings'
b=line(s,[(336,144),(496,144)])+line(s,[(784,144),(928,144)])+line(s,[(1072,192),(1072,328)])+line(s,[(928,376),(784,376)])+line(s,[(496,376),(336,376)])
b+=line(s,[(640,424),(640,504)],True)
b+=label(416,130,'输入与验证')+label(856,130,'实际保存')+label(1084,266,'选取角色配置','start')+label(856,362,'调用前解析')+label(416,362,'分别诊断')
b+=node(48,96,288,'设置工作区','Provider / 工具 / 记忆 / 插件','主题、热键、日志与系统配置','input')
b+=node(496,96,288,'共享配置契约','normalizeConfig / 能力校验','角色身份与公共交流规则分开','focal')
b+=node(928,96,288,'本地配置持久化','JSON + safeStorage 凭据','保存成功后广播配置变化','store','storage.html')
b+=node(928,328,288,'按角色解析模型配置','resolveCharacterConfig','Provider profile / model / soul')
b+=node(496,328,288,'具体能力消费者','聊天 / Agent / 日志 / 记忆','按功能使用对应 Provider')
b+=node(48,328,288,'诊断与可用性检查','Provider 与 Embedding 分开','缺配置明确阻止相关调用')
b+=node(496,504,288,'能力切换与生命周期','按设置重建或重新配置服务','不等于所有变更都重启全应用','optional')
b+=finish(note('图中是配置传播与使用关系，不是设置页面布局重设计。'))
add(s,'数据与基础设施','配置、人设、模型与能力诊断','控制平面如何影响各业务模块，而不混淆身份与执行配置。',b,
 ['设置写入共享配置模型；凭据经系统能力保护后保存，服务按配置变化重新配置。','联系人有独立身份和可选择的模型配置，公共交流规则来自共享契约。','模型连接诊断与 Embedding 诊断分开；任务工作参数有版本与权限检查。'],
 '不读取现有 API Key、角色私有正文或远程账户状态。本图说明静态代码组织，不表示某个 Provider 当前可用。',
 ['src/shared/config.ts','src/shared/characters.ts','src/shared/contact-communication.ts','src/main/provider-probe.ts','src/main/ai.ts','src/renderer/src/components/Settings/Settings.tsx','src/main/ipc.ts'],['chat','memory','extensions','lifecycle'])

# 18. Lifecycle and desktop integration, with honest running boundaries.
s='lifecycle'
b=line(s,[(336,144),(496,144)])+line(s,[(784,144),(928,144)])+line(s,[(1072,192),(1072,328)])+line(s,[(928,376),(784,376)])+line(s,[(496,376),(336,376)])+line(s,[(192,424),(192,504)])
b+=label(416,130,'app ready')+label(856,130,'注册与初始化')+label(1084,266,'创建窗口后','start')+label(856,362,'日常运行')+label(416,362,'退出请求')
b+=node(48,96,288,'应用启动','用户数据目录 / 主配置','smoke 使用独立数据目录','input')
b+=node(496,96,288,'注册核心能力','数据库、记忆、工具与插件','日志、任务、Agent、助手安排')
b+=node(928,96,288,'创建窗口与 IPC','BrowserWindow / preload','然后启动异步插件初始化')
b+=node(928,328,288,'桌面系统集成','托盘 / 全局快捷键 / 剪贴板','打包版按设置自启与检查更新')
b+=node(496,328,288,'运行中的陪伴反馈','状态机 / 主动触发 / 未读','主动消息未读保持托盘闪烁','focal')
b+=node(48,328,288,'有序停止服务','停止监听与定时器','关闭后台执行与日志资源')
b+=node(48,504,288,'刷新数据并退出','保存失败可见，不假报落盘','重启依持久记录恢复','store')
b+=t(496,518,'运行边界','group-title')+t(496,552,'关闭聊天面板仍可工作；退出应用、关机或休眠时不能声称持续执行。','small')
b+=finish(note('托盘、提醒、未读和待处理是相互关联的机制，但“已读”不等于“已解决”。'))
add(s,'数据与基础设施','启动、桌面陪伴与退出恢复','窗口之外的托盘、热键、更新和后台服务如何组成桌面应用。',b,
 ['入口先注册必要服务，再创建窗口和 IPC，异步初始化插件，最后接入托盘、热键和剪贴板。','主进程驱动托盘未读闪烁，Renderer 的状态机控制宠物显示与主动触发。','退出时关闭各服务并刷新持久数据；后台工作需要应用保持运行。'],
 '图合并了服务初始化顺序中的独立步骤，不能当作每个 await 的精确时序。更新与自启动行为受打包状态、平台及用户配置控制。',
 ['src/main/index.ts','src/main/tray.ts','src/main/tray-flasher.ts','src/main/hotkey.ts','src/main/updater.ts','src/renderer/src/core/state-machine.ts','src/renderer/src/core/proactive.ts','src/main/reminders/service.ts'],['processes','assistant','delivery','settings'])

lookup={d['slug']:d for d in diagrams}
def link(slug):
    d=lookup[slug];return f'<a href="{slug}.html">{d["number"]} · {escape(d["title"])}</a>'
def page(title,body):
    return f'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)}</title><style>{CSS}</style></head><body><main>{body}<footer>CHOUYU ARCHITECTURE ATLAS · 源码核对 {escape(stamp)}<br>Diagram Design 浅色风格 · 1280 × 720 · 使用本机字体，支持离线阅读。静态源码说明不等于运行验收。<br><a href="README.md">阅读与维护说明</a> · <a href="source-snapshot.json">完整版本与来源记录</a></footer></main></body></html>'
def figure(d):
    result=svg(d['slug'],d['title'],d['subtitle'],d['body'])
    if d['kind']=='SEQUENCE':
        marker=f'<marker id="{d["slug"]}-arrow-open" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polyline points="0 0,8 3,0 6" fill="none" stroke="{MUTED}" stroke-width="1.2"/></marker>'
        result=result.replace('</defs>',marker+'</defs>')
    return result
def section(d):
    sources=''.join(f'<a href="../../{escape(p)}">{escape(p)}</a>' for p in d['sources'])
    reading=''.join(f'<p>{escape(p)}</p>' for p in d['reading'])
    return f'''<section class="module-section"><p class="eyebrow">{d['number']} / {d['kind']} / {d['group']}</p><h1>{d['title']}</h1><p class="intro">{d['subtitle']}</p><p class="mobile-hint">横向滑动查看完整图面；带链接的模块可继续展开。</p><div class="diagram-container" tabindex="0" role="region" aria-label="{d['title']}，可横向滚动">{figure(d)}</div><div class="notes"><div><h3>如何读这张图</h3>{reading}</div><div><h3>范围与验证边界</h3><p>{d['boundary']}</p></div></div><div class="source-block"><h3 class="mini">代码与规范入口</h3><p class="sources">{sources}</p></div><div class="diagram-links">继续看：{''.join(link(slug) for slug in d['related'])}</div></section>'''

for i,d in enumerate(diagrams):
    top='<div class="topbar"><a href="index.html">← 图册目录</a><span>'+('' if i==0 else link(diagrams[i-1]['slug']))+('' if i==len(diagrams)-1 else '　 / 　'+link(diagrams[i+1]['slug']))+'</span></div>'
    emit(d['slug']+'.html', page(d['title'],top+section(d)))

header=f'''<header><p class="eyebrow">CHOUYU / ARCHITECTURE ATLAS</p><h1 class="atlas-title">从整个系统，<br>一路看到<strong>每个主要模块。</strong></h1><p class="intro">18 张相互关联的架构图。先看全局职责和真实进程边界，再沿着聊天、任务、日志、记忆与存储逐层展开。每张图都附代码入口、阅读说明和省略范围。</p><p class="stamp">源码核对：{escape(stamp)} · 点击图中模块可继续展开</p><p class="notice">图册描述上述版本的静态源码；源码链接打开当前检出的文件。后续改动需重新核对相关图，不代表已发布版本或运行验收。旧设计、未接入的可选协议与实际执行服务已区分。</p></header>'''
body=header+'<nav><a href="system.html">先看系统架构 →</a><a href="processes.html">查看进程边界 →</a><a href="README.md">阅读与维护说明 ↗</a></nav>'
body+='<div class="diagram-container" tabindex="0" role="region" aria-label="系统架构总览，可横向滚动">'+figure(diagrams[0])+'</div>'
for group in ['系统全景','聊天与任务','功能模块','数据与基础设施']:
    body+=f'<div class="toc-group"><h2>{group}</h2><div class="toc-grid">'
    for d in diagrams:
        if d['group']==group:body+=f'<a class="toc-link" href="{d["slug"]}.html"><span>{d["number"]}</span><div><b>{d["title"]}</b><small>{d["subtitle"]}</small></div></a>'
    body+='</div></div>'

coverage=[
 ('桌面 / 前端','App、Pet、ChatPanel、Workspace、Onboarding、Settings','frontend','lifecycle'),
 ('会话与 AI','会话存储、模型协议、流式响应、人设与公共交流契约','chat','settings'),
 ('联系人工作','Agents：topics、runtime、research、delivery、sources、interactions、analytics','contacts','runtime'),
 ('并发与恢复','AgentService、RPC、检查点、任务退避、Token 与调用预算','scheduling','processes'),
 ('助手安排 / 提醒','assistant-routines、companion、proactive、reminders','assistant','delivery'),
 ('用户待办','tasks store、scheduler、recovery、backup、分组清单与自定义视图','todos','storage'),
 ('日志采集','activity-helper、capture、OCR、journal-worker、storage-budget','journal','perception'),
 ('日志整理','evidence、summary、semantic-search/cache、tasks、weekly、saved、projects、playbook','journal','search'),
 ('长期记忆','service、provider、SQLite/Mem0、embedding、sync、维护与冲突处理','memory','extensions'),
 ('扩展','plugins、BBTalk、tool registry、plugin-tools、capabilities、可选进程 transport','extensions','chat'),
 ('系统输入与图片','剪贴板、截图、滚动拼接、离线 OCR、attachment-store','perception','storage'),
 ('系统基础设施','database、store-file、tray、hotkey、updater、配置与诊断','storage','lifecycle'),
 ('测试与评估支持','smoke、evaluation、*.test、scripts：开发验证辅助，不是用户业务服务','system','settings')]
body+='<section><h2>模块覆盖索引</h2><p class="intro">“每个模块”按主要业务职责展开；叶子组件与工具函数归入所属模块，不为每个文件单独画一张空洞的图。</p><table class="coverage"><thead><tr><th>模块范围</th><th>包含内容</th><th>图入口</th></tr></thead><tbody>'
for name,contents,a,c in coverage:body+=f'<tr><td>{name}</td><td>{contents}</td><td>{link(a)}<br>{link(c)}</td></tr>'
body+='</tbody></table></section>'
emit('index.html', page('ChouYu · 系统与模块架构图册',body))
emit('atlas-manifest.json', json.dumps([{k:v for k,v in d.items() if k!='body'} for d in diagrams],ensure_ascii=False,indent=2))
if outdated:
    raise SystemExit('Generated files are outdated; run build_atlas.py:\n'+'\n'.join(outdated))
print(f'{"Checked" if args.check else "Generated"} {len(diagrams)} diagrams + index.html and manifest.')
