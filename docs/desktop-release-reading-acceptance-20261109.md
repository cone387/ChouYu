# 桌面候选包与成果阅读验收

日期：2026-11-09。基线 `670e4ac`，产品改动提交 `3c6356e`，已快进合并到本地 `master`。测试使用独立 userData、合成任务和本地模型协议；未操作用户正在运行的实例、任务或模型配置。

## 已修复与验证

- 自动更新检查、下载失败不再产生未处理的 Promise 拒绝；关闭窗口后迟到的更新事件和确认结果不会操作失效窗口；原生对话框失败也有反馈。仍由用户确认下载和重启安装。
- 鼠标固定不动时，弹窗开关、位置/尺寸变化、滚动与布局更新也会重新命中检测。变化合并到渲染帧，主进程仍只在状态变化时设置穿透；宠物、窗口和外部文件拖拽保护保留。
- 完整桌面回归通过：导航、聊天、滚动、任务与联系人弹窗、穿透、窗口交互、确认、提醒及去重。修正了旧六项导航断言、作者夹具受到独立设计师请求干扰、操作隐藏的总览联系人详情，以及重复穿透状态不广播的错误测试前提。未为测试放宽产品可见性或增加重复广播。
- 休眠/唤醒事件回归覆盖迟到采集、手动暂停保持、休眠期间不生成活动；包内任务恢复和 v1.3.4 数据升级检查通过，核对聊天、未读、收据、未完成/完成任务及 schema。
- 成果设计师除首屏与章节交互外，会在长页中段、末尾实际滚动并截图。每种环境最多抽取三个阅读状态的中段/末尾，记录截图 ID 与位置，所有采样错误参与启用判断。视觉模型明确接收这些图片及位置，不再只检查首屏。
- 滚动按内容比例定位，覆盖超过 100,000 像素的长页；滚动及输入后等待布局帧再截图。默认正文行长约 42 个中文字符，维持 17px 字号、1.85 行距、375/1024 宽和亮暗主题。没有改写作者正文或新增一套任务 UI。
- Native 模型明确拒绝图片输入时，提示为界面设计师选择支持图片的模型后重试，并保留原文。认证、限流等其他失败不会被误判为图片能力问题，不自动更换模型或执行器。
- 尚未完成的显式“调整界面”请求不会因新正文到达而失去优先级；即使分节 ID 不变，也必须实际生成所要求的调整。请求成功发布后，后续自动更新才可复用该设计。设计指令补充单节直接进入正文、避免重复标题与短文封面。

## 证据

工作区 `artifacts/desktop-release/` 保留原始失败与修复后日志：

| 验证 | 证据与结论 |
| --- | --- |
| 完整桌面 | `smoke-dashboard-final.log`，通过 |
| 休眠事件/鼠标/更新回归 | `recovery-expanded.log`：90 项通过；`updater-final.log`：5 项通过 |
| 更新器修复前 | `updater-red2.log`：销毁窗口断言失败、4 个未处理拒绝；修复后通过 |
| 长文采样回归 | `reading-red.log`：中段/末尾未检查导致两项失败；`reading-green.log`：5 项通过 |
| 模型图片能力反馈 | `model-image-red.log`：两类图片拒绝未给出可操作信息；`design-green.log`：工作流及模型共 10 项通过 |
| 排版实际失败 | `smoke-reading-red.log`：1024 宽默认行长超过约 42 字；375 宽及超长文比例滚动已通过 |
| 独立成品依赖 | `packaged-clean-sqlite.log`：Electron 44.9.3 / win32 x64 SQLite checkpoint 持久化通过 |
| 成品恢复及升级 | `packaged-recovery.log`：任务恢复及 v1.3.4 数据升级通过 |
| 静止鼠标实际回归 | `smoke-pointer-red.log`：不移动鼠标打开模态后原生穿透未改变；`smoke-pointer-green.log`：弹窗开关、移动、外部拖拽及完整联系人流程通过 |
| 显式调整与新正文 | `explicit-edit-red.log`：持久请求优先级丢失及跳过生成两项失败；`explicit-edit-green.log`：17 项通过 |
| 最终全量单测 | `full-tests-final.log`：单 worker，317 文件、2,385 项通过，17 文件/62 项按既有条件跳过；无失败或 worker 异常 |
| 类型与模块边界 | `typecheck-final.log`、`boundaries-final.log`：通过 |
| 成果设计师 Electron | `smoke-reading-cdp.log`：通过；10 次本地协议调用、41 张真实截图，四类正文、长文中段/末尾、章节、嵌入页及失败回退 |
| 最终成品完整桌面 | `packaged-final-full.log`：通过，`1.4.3-rc.1 packaged=true`；包含静止鼠标、聊天、日记、确认、联系人、提醒 |
| 最终成品原生依赖/构建匹配 | `packaged-final-sqlite.log` 通过；`package-source-match.json` 核对 28 个主进程/预加载/界面文件与源码构建逐字节一致 |
| 最终成品恢复与阅读 | `packaged-final-recovery.log`、`packaged-final-designer.log` 通过；旧数据核对通过，成品设计师 10 次本地请求/41 张实图 |
| 最终成品成果集 | `packaged-final-portfolio.log`：`--contact-experience` 通过；固定版本、重启继续阅读、精确引用、反馈失败/重试与成果修订；人工复核成品成果集反馈截图 |

最初四 worker 全量测试为 2,376 项通过、62 项按配置跳过，但 `background-selection.test.ts` 的 worker 原生退出（3221226505），因此该次整体失败。该文件独立两项通过；最终固定产品源码的单 worker 全量复核通过，不能据此声称已定位原生退出根因。另有一次运行与新增 TDD 失败回归重叠，捕获了该测试的预期失败（`full-tests-during-tdd.log`），不计入通过结果。

独立整分支审查发现静止鼠标和显式调整两个 Important 缺口，均先用失败回归复现，再修复；最终全量单测与相关实际 Electron 回归通过。没有其余具体代码问题；在线质量、实体硬件、干净系统安装及公开更新保留为待验收，不视为审查通过证据。

人工复核了 `dashboard-final/` 的窄窗深色确认弹窗及宽窗统计页，和 `reading-final2/result-designer/` 的窄窗小说首屏/暗色末尾、宽窗研究及真实任务容器。长文末段无截断，正文在宽窗保持阅读行长。确定性短文夹具仍展示重复标题/封面问题，因此补充了设计指令；不能用指令已修改推断在线生成已改善。

阅读键盘检查曾因隐藏宿主、焦点顺序以及 Electron `sendInputEvent` 未向跨进程 iframe 递送按键而失败。最终显示并聚焦原生宿主后等待真实子帧焦点，使用 Chromium CDP 键盘输入，核对正文实际收到 Home/PageDown 且主阅读区域正确滚动。没有替换为 DOM 合成键盘事件或直接设置滚动值来冒充按键效果。

## 打包与复现

最终候选包：`D:/codespace/ChouYu/dist/desktop-verified-rc/ChouYu Setup 1.4.3-rc.1.exe`，292,872,814 字节。SHA-256：`c9cb6087a0e63f1ee353c0dbf93e10548a782e773124bcd128421f9c927b7bf7`；同目录包含 blockmap 和 `SHA256SUMS.txt`。安装器与应用的 Authenticode 状态为 `NotSigned`，未签名、未公开发布。

`package-verified-installer.log` 构建退出码 0。`installer-payload-test.log` 验证 27,955 个文件 / 1,105,444,517 字节，全部通过；`installer-container-test.log` 直接读取 EXE 内嵌 7z 也通过，额外尾部数据提示来自 NSIS 外壳。`installer-source-match.json` 核对从安装器提取的 `app.asar` 与已运行验证的应用逐字节一致。以上不等同于实际执行安装、卸载或自动更新。

源包版本仍为 `1.4.2`；本地候选通过 metadata 标记为 `1.4.3-rc.1`，未建 tag、上传或发布到公共更新源。

隔离工作树的 `node_modules` 是开发依赖 junction，直接打包曾遗漏 `@langchain/langgraph-checkpoint`（见 `packaged-sqlite.log`）。最终打包使用真实的独立生产依赖目录，不能使用该失败产物。

最终应用位于 `dist/desktop-final-rc/win-unpacked`，安装器使用新的 `dist/desktop-verified-rc` 输出目录。曾中断的最大压缩产物被打包器误当作可复用缓存；该安装器已改名为 `interrupted-installer.exe.invalid`，不可使用。最终从已验证的应用目录在全新输出位置重新归档，设置 `ELECTRON_BUILDER_COMPRESSION_LEVEL=5`；不复用中断缓存。

关键日志与成品阅读截图另存于主工作目录 `artifacts/desktop-release-20261109/`；完整原始失败及诊断日志保留在隔离工作树 `C:/Users/Administrator/.codex/worktrees/8ee3/ChouYu/artifacts/desktop-release/`。

```powershell
# 在本工作树执行；temp/package-app 是一次性构建目录，不能指向用户数据。
New-Item -ItemType Directory temp/package-app -Force
Copy-Item package.json,package-lock.json temp/package-app
npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix temp/package-app
npm run build
npm run build:dsh-runtime
# 将 out/main、out/preload、out/renderer 复制到干净的 temp/package-app/out。
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL='5'
# 使用全新输出目录；中断后也必须换新目录，避免打包器复用残缺归档。
node node_modules/electron-builder/cli.js --win --publish never '--config.directories.app=temp/package-app' '--config.extraMetadata.version=1.4.3-rc.1' '--config.directories.output=dist/new-desktop-rc'
node scripts/verify-sqlite-runtime.cjs dist/new-desktop-rc/win-unpacked/ChouYu.exe dist/new-desktop-rc/win-unpacked/resources/app.asar
node scripts/smoke-electron.js --packaged dist/new-desktop-rc/win-unpacked/ChouYu.exe --contact-reliability --upgrade-v134
```

## 仍需实际验证

- 在线视觉质量：只读查看现有设计元数据发现图片输入曾被供应商以“仅接受 text”拒绝，未见已启用设计。当前配置 `as-glm-5.3` 的能力复验/替代模型待确认，本轮没有调用在线付费服务。四类本地样例不能证明在线审美效果。
- 长文检查为有界代表性采样，不能证明任意页面的每个像素或所有交互组合正确。设计页仍使用安全正文文本投影，Markdown 语义排版、表格与精确引用继续由可信原文阅读器提供。
- 硬件：当前仅一块 125% 显示器。事件测试不能替代真实睡眠/唤醒，等效视口不能替代混合 DPI、多屏拔插或实体触控板验收。
- 发布：独立包内运行不等于干净系统安装、卸载、自启或公共自动更新端到端验收；这些外部验证仍遵循 `windows-manual-acceptance.md`，不把历史记录改成已完成。
