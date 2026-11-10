# ChouYu 1.4.3 发布验证

日期：2026-11-10。基于 `e199c53` 的完整本地 master 准备正式版本，包含 v1.4.2 之后的总览与用量统计、任务请求追踪、成果界面设计师及桌面可靠性改动。发布说明见 [v1.4.3](releases/v1.4.3.md)。

## 本地检查

- Node.js 24.15.0；锁定依赖为 Electron 44.9.3、Vitest 5.0.5、electron-builder 26.15.3。
- `npm run typecheck`、`npm run check:boundaries` 通过。
- `npm test` 使用现有四 worker 配置通过：317 文件、2,385 项通过；17 文件、62 项按既有条件跳过，120.72 秒。
- `npm run test:memory-eval` 通过，仅代表合成语料的提取、检索及冲突评测，不代表在线模型质量。
- `npm audit --audit-level=high` 通过门槛；打包开发依赖 minimatch 及其上游链有 6 项中危报告，没有高危项。未执行会降级 electron-builder 的强制修复。
- `npm audit --prefix runtime/dsh --omit=dev --audit-level=high` 为 0 项。
- `npm run test:smoke` 生产构建及完整 Electron 桌面冒烟通过，记录 `CHOUYU_SMOKE_READY version=1.4.3 packaged=false` 与 `Electron smoke test passed.`；使用隔离数据和本地协议。
- 本地原始日志保存在 `artifacts/release-1.4.3/`。

## 补充成果阅读检查

标签推送后额外运行 `--result-designer`，原测试两次在 Home/PageDown 记录断言失败，虽然父阅读区域已经滚动；原始日志为 `result-designer.log`、`result-designer-reproduce.log`。诊断读取显示宿主和隔离正文焦点均正确，加入跨进程诊断读取后两个按键均到达且完整专项通过（`result-designer-diagnostic.log`）。

测试随后在 CDP PageDown 调用后等待隔离正文真实 `keydown` 记录，再执行原有按键序列及滚动断言；没有重发按键、合成 DOM 按键、重新设置焦点或直接修改滚动位置。此同步修正后专项通过（`result-designer-event-wait.log`），10 次本地模型协议请求、41 张真实截图。该测试同步改动随发布验证记录单独提交，未改变 v1.4.3 标签中的产品行为；不据此宣称所有硬件或键盘交互已完成验收。

补充改动的类型检查通过。其后本地四 worker 全量复核出现两个原生 worker 退出（3221226505），涉及 `reliability-protocol.test.ts` 和 `fake-mem0-server.test.ts`（`tests-smoke-sync.log`）；单 worker 全量为 2,384 项通过、1 项失败，具体为 `dsh/openai stops at deadline before next-round with one actual HTTP attempt` 收到“DSH 通信已断开。”而非预期截止错误（`tests-smoke-sync-single.log`）。这两个文件随后独立复核 19 项全部通过（`tests-worker-recheck.log`）。保留失败，不把独立通过称为全量通过或偶发问题根因已解决；正式标签的云端全量质量检查另行完整通过。

## 正式发布门槛

正式标签 `v1.4.3` 指向 `0f91f65c8a69dc313289fee9625149171ac89968`。[发布流水线 42775776156](https://github.com/cone387/ChouYu/actions/runs/42775776156) 的 quality、prepare-release、build-windows、build-macos、publish-release 全部成功；于 2026-11-10 15:51:31（Asia/Shanghai）公开并设为 Latest。API 确认不是草稿或预发布，8 项附件均已上传。[正式下载](https://github.com/cone387/ChouYu/releases/tag/v1.4.3)。

云端 Windows 包内完整桌面、DSH、v1.3.4 数据升级、联系人恢复及两平台 SQLite 持久化检查均通过。完整流水线日志、Release API 快照和更新清单已保存到本地证据目录。

沿用 `.github/workflows/release.yml`：标签质量检查成功后创建草稿，Windows 与 macOS 分别构建并上传，验证两平台成品 SQLite 持久化及 Windows 完整冒烟、DSH、v1.3.4 升级和联系人恢复；两平台全部成功且安装包、ZIP 与更新清单齐全后自动公开。

正式产物以标签 CI 的干净安装及构建为准，不复用本地 rc 安装包。历史候选包的完整桌面、成果阅读和恢复证据及其原始失败记录见 [2026-11-09 验收](desktop-release-reading-acceptance-20261109.md)。

下载云端 Windows 安装包后，核对其 277,467,383 字节大小及 SHA-512 与 `latest.yml` 完全一致。SHA-256 为 `5483eeb0d395e63512073badb3b1e08044490af60422106475874c4f890b662f`，本地校验记录为 `installer-integrity.json`。两平台更新清单版本均为 1.4.3；macOS ZIP 为 261,358,057 字节、DMG 为 261,318,130 字节。

## 已知边界

未配置安装包代码签名或 macOS 公证。在线视觉模型质量、实体睡眠/唤醒及混合 DPI 多屏、干净系统安装/卸载/自启和公共自动更新端到端仍未完成专项验收；不以源码测试或成品冒烟代替这些结果。发布说明保留上述限制。
