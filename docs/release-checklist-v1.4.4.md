# ChouYu 1.4.4 发布验证

2026-11-11。仅发布 Windows 安装器长路径升级修复及对应安装回归；应用功能沿用 1.4.3。问题、根因、修复和先前失败记录见 [安装修复验证](windows-installer-long-paths.md)。

## 本地已完成证据

- 修复前实际 NSIS Rename 失败，修复后长路径移动、已有前缀、失败退出码、环境恢复通过。
- 独立 appId 的真实 NSIS 小型安装包：旧版安装、旧卸载器升级移除失败及回滚、修复后升级、实际 APPDATA 数据保留、普通卸载通过。
- 应用完整测试：317 文件、2,385 项通过；17 文件、62 项跳过（117.51 秒）。
- Windows 成品完整桌面冒烟通过；包内 DSH 27,807 个资源及 Node 校验通过。
- 发布准备时移除安装测试对本机旧 NSIS 缓存目录的假设，改用当前 electron-builder 的编译器定位与环境设置，兼容干净构建机。

发布准备的首次全量复核有 1 项失败：`runtime-lifecycle.test.ts / does not start a peer host tool after its pending context check outlives the runtime`，错误为 `DSH 已关闭。`，来自 `DshTransport.close`；其余 2,384 项通过。该文件随后独立复核 16 项全部通过。该次失败日志保留在 `artifacts/release-1.4.4/tests.log`，独立复核为 `lifecycle-recheck.log`；未修改运行时逻辑、不宣称其间歇性问题已根治，发布仍要求完整复核及云端门槛通过。

同一发布工作树随后完整重跑通过：317 文件、2,385 项通过，17 文件、62 项跳过，94.93 秒（`tests-recheck.log`）。1.4.4 的类型检查、模块边界、动态定位 NSIS 后的安装器回归与完整升级专项均通过。

## 正式发布门槛

版本与 lockfile 同步为 1.4.4。使用 `v1.4.4` 标签触发现有流水线：质量检查成功后创建草稿；Windows/macOS 分别构建，完成 SQLite、桌面冒烟、DSH、数据升级、联系人恢复及新增安装器检查；全部成功且附件齐全后公开为 Latest。

## 正式发布结果

标签 `v1.4.4` 指向 `153881e70f857ab0c9c2c082e33be905d31eea84`。[发布流水线 42949658892](https://github.com/cone387/ChouYu/actions/runs/42949658892) 的 quality、prepare-release、build-windows、build-macos、publish-release 全部成功，2026-11-11 11:24:53（Asia/Shanghai）公开并设为 Latest。API 确认不是草稿或预发布，8 项附件齐全。

标签云端全量为 317 文件、2,385 项通过，17 文件、62 项跳过。Windows 的长路径迁移、已有前缀、失败退出码与环境恢复，以及旧版安装、失败回滚、修复后升级、APPDATA 保留、卸载回归均通过。两平台 SQLite 和 Windows 完整桌面、DSH、v1.3.4 数据升级、联系人恢复验证通过。

下载正式附件后验证：Windows EXE 为 277,467,746 字节，SHA-256 `7f3b69e07886bd1e4f4bcd82a84ff27f8cfc09c04f53c39f193d77a14854bf09`；macOS ZIP 为 261,358,321 字节。二者 SHA-512 均与版本为 1.4.4 的更新清单完全一致，SHA-256 与 Release API 的 digest 一致。正式 Windows 安装包已复制到用户下载目录。

原始流水线日志、API 快照、更新清单和校验结果保存在 `artifacts/release-1.4.4/`（`release-workflow.log`、`workflow.json`、`release.json`、`latest-release.json`、`verified-assets.json`）。

## 独立 master CI 失败记录

同一提交的 [master Quality 42949658883](https://github.com/cone387/ChouYu/actions/runs/42949658883) 首次有 6 文件、10 项测试/清理超时，涉及 `database.test.ts`、`agents/assignment.test.ts`、`agents/chapter-continuation.test.ts`、`agents/chat-controls.test.ts`、`agents/delivery-counts.test.ts`、`agents/task-context.test.ts`。重跑仍有 3 项 5 秒测试超时：`database.test.ts` 的历史正文懒加载、`agents/delivery.test.ts` 的偏好与输出元数据、`tasks/store.test.ts` 的 v10 视图备份升级。日志分别为 `master-ci-failed.log`、`master-ci-recheck-failed.log`。

未放宽超时、跳过断言或继续重跑直到通过；保留该独立流水线失败状态，不将发布标签流水线成功描述为所有 CI 均成功。安装修复不包含这些运行时/测试稳定性问题的根因修复。
