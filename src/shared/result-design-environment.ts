import { DESIGN_ENVIRONMENT_VERSION, type DesignEnvironment } from './result-design'
export function designEnvironment(width:number,theme:'light'|'dark'):DesignEnvironment {
  return {version:DESIGN_ENVIRONMENT_VERSION,width,height:width===375?700:768,theme,
    font:'"Microsoft YaHei", "PingFang SC", sans-serif',
    tokens:theme==='dark'?{'--surface':'#202124','--text':'#ededed','--muted':'#a8adb5','--line':'#45474b','--accent':'#a3c2ec','--panel':'#292b30'}:
      {'--surface':'#ffffff','--text':'#282a2e','--muted':'#626872','--line':'#dedfe2','--accent':'#315f96','--panel':'#f4f5f7'}}
}
export const designEnvironmentInstruction=`你负责任务成果区域，不修改应用导航、聊天、设置或作者正文。
根据内容选择排版：小说注重连续阅读和章节导航；研究突出结论、依据和比较；想法突出各项差异；评审明确结论和证据。
宿主负责本地字体、主题、字阶、间距与响应式样式；你根据正文选择组件布局和重点，不添加无意义封面、装饰或进度汇报。
所有标题、正文与来源由宿主从固定版本读取，只能排列与强调，不能替换、删减或用摘要冒充。不要添加虚假统计、外部内容或业务操作。
实际预览包含375和1024宽、亮暗主题；检查正文行长、层级与可达性。宿主统一纵向滚动，长表格仅横向滚动。若视觉检查不通过，请在可用布局中调整。
本轮使用 A2UI 宿主组件，不生成 HTML/CSS/JavaScript。只生成 {"title":"成果展示名称","a2ui":{"kind":"report","sections":[{"id":"目录中的真实分节ID","treatment":"emphasis"}]}} JSON。
kind 只能是 document（通用正文）、story（连续章节，舒展行距）、report（结论与依据，重点分节突出）、ideas（多想法并列，窄屏单列）、steps（确为顺序操作的步骤）。
sections 必须列出本次目录的全部分节，各一次。可按内容决定排列顺序，不能用新正文或摘要替换。treatment 仅 body 或 emphasis，emphasis 适合报告已有的结论、建议等分节，不能把步骤当结论。
宿主将这些引用组合为 ReadingDocument、ReadingContents、ReadingSections 与 SavedSection 组件，正文、来源和 Markdown 语义来自固定版本。单分节不重复标题或强塞目录。现有旧代码只是历史参考，不要输出 html/css/script。`
