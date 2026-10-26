# ChouYu 1.4.0 发布验证

日期：2026-10-26。正式公开状态和双平台构建结果以 GitHub 的 `v1.4.0` Release 及对应 Actions 为准。

- Windows / Node 24.15.0：最终依赖全量测试 282 个文件、2189 项通过，61 项跳过；类型检查、模块边界、记忆合成评测与构建通过。
- 应用及独立 DSH 运行时审计均为 0 个漏洞。应用锁更新 Electron 44.9.3、Vitest 5.0.5、Vite 7.3.7；DSH 维持 0.2.1-alpha.3，仅覆盖兼容主版本中的 Zod、undici、fast-uri、fflate、MCP client 安全更新，并同步 MCP core。
- 新工作区第一次测试在 DSH 安装尚未完成时启动，导致相关测试失败，另有迁移测试超时；完整安装后全量通过。CI 已增加独立运行时安装及审计，保留首次失败日志，不将缺依赖的运行计为通过。
- 升级夹具的任务库由 `v1.3.4` 原 TasksStore 生成（schema 7），JSON 使用该版本的 version 4 会话结构；全部为合成数据。开发产物已验证任务 schema 升至 12、未完成/已完成状态、正文、未读边界和送达记录保留，以及旧 JSON 备份存在。
- 发布流水线在 Windows 安装包生成后依次运行完整成品回归、DSH 实际 SDK、旧版数据升级和联系人故障恢复。Windows 与 macOS 构建全部成功后，才将共享草稿公开并更新自动升级元数据。
- 独立审查覆盖发布流程、迁移夹具和最终依赖锁，没有遗留 Critical / Important 项。安全审计不能代替运行兼容验证。

本机日志位于 `%TEMP%/chouyu-release-*.log`。首次旧 DSH 依赖的本地 NSIS 压缩在安全更新后被主动停止，该产物不用于发布；正式成品由最终锁文件重新构建。

限制：不把合成迁移或解包程序运行等同于干净 Windows 安装/卸载验收，不宣称完成 macOS 人工运行、全天常驻或真实断电验证。macOS 不内置 DSH；其余模型解析和 Windows WAL 边界见[可靠性验收](contact-reliability-acceptance-20261026.md)及[发布说明](releases/v1.4.0.md)。
