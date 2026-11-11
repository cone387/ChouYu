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

本文件初始提交时正式流水线尚未执行，不能将本地通过等同于正式发布成功。正式状态和产物校验在流水线结束后补充。
