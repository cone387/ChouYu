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
- 本地原始日志保存在 `artifacts/release-1.4.3/`。最终标签流水线与发布状态将在执行后补记。

## 正式发布门槛

沿用 `.github/workflows/release.yml`：标签质量检查成功后创建草稿，Windows 与 macOS 分别构建并上传，验证两平台成品 SQLite 持久化及 Windows 完整冒烟、DSH、v1.3.4 升级和联系人恢复；两平台全部成功且安装包、ZIP 与更新清单齐全后自动公开。

正式产物以标签 CI 的干净安装及构建为准，不复用本地 rc 安装包。历史候选包的完整桌面、成果阅读和恢复证据及其原始失败记录见 [2026-11-09 验收](desktop-release-reading-acceptance-20261109.md)。

## 已知边界

未配置安装包代码签名或 macOS 公证。在线视觉模型质量、实体睡眠/唤醒及混合 DPI 多屏、干净系统安装/卸载/自启和公共自动更新端到端仍未完成专项验收；不以源码测试或成品冒烟代替这些结果。发布说明保留上述限制。
