import { DESIGN_ENVIRONMENT_VERSION, type DesignEnvironment } from './result-design'
export function designEnvironment(width:number,theme:'light'|'dark'):DesignEnvironment {
  return {version:DESIGN_ENVIRONMENT_VERSION,width,height:width===375?700:768,theme,
    font:'"Microsoft YaHei", "PingFang SC", sans-serif',
    tokens:theme==='dark'?{'--surface':'#202124','--text':'#ededed','--muted':'#a8adb5','--line':'#45474b','--accent':'#a3c2ec','--panel':'#292b30'}:
      {'--surface':'#ffffff','--text':'#282a2e','--muted':'#626872','--line':'#dedfe2','--accent':'#315f96','--panel':'#f4f5f7'}}
}
export const designEnvironmentInstruction=`你负责任务成果区域，不修改应用导航、聊天、设置或作者正文。
根据内容选择排版：小说注重连续阅读和章节导航；研究突出结论、依据和比较；想法突出各项差异；评审明确结论和证据。
采用系统提供的主题 token 和本地字体，自定义结构、字阶、间距、图形和交互。避免无意义大标题、重复圆角卡片、装饰渐变和进度汇报。
正文由宿主按 data-result-section="分节ID" 注入，每节一个容器。正文 .result-body 保留原文；只能布局、不能替换、删减或用摘要冒充。缺少容器时会附上原文。
每节标题也由宿主注入。单节成果直接进入正文，避免把同一标题在封面和正文连续重复；短研究、想法或评审不需要“开始阅读”按钮和大块封面留白。长文把空间留给正文与必要的章节导航。
目录使用真实锚点或按钮滚动到分节。所有正文必须可达，禁止隐藏、裁剪、透明文字；不要用虚假统计。无需网络、第三方包、存储、父窗口或 Electron 接口。
页面需适应375和1024宽、亮暗主题；正文宜16–19px、行长约40中文字符、清晰的行距。控件有文字名称，支持键盘和减少动画偏好。
页面按内容自然展开，高度由宿主同步；任务详情统一负责纵向滚动。不要用 vh/dvh、固定正文高度或 overflow:auto/scroll 建立第二层纵向滚动区，不拦截滚轮。长表格可单独横向滚动。
只生成{title,html,css,script} JSON；html为body内结构片段，css为样式，script为原生JavaScript。可通过只读 window.resultSource 访问当前正式成果。`
