# Windows 升级提示“ChouYu 无法关闭”

2026-11-11：用户从 1.4.2 升级到 1.4.3，安装器反复显示无法关闭。下载的安装包 SHA-256 与发布记录一致，检查时没有运行中的 ChouYu 进程。

## 原因和修复

旧版 DSH 依赖带有很长的 devtools 说明文件名。electron-builder 的旧卸载器在升级时将文件移到 `%TEMP%\ns*.tmp\old-install`，再进行删除；当前用户名下的目标路径达到 262 字符。NSIS Rename 失败后恢复旧文件，安装器重试旧卸载器数次，最终复用了“无法关闭”的错误提示。

`resources/installer.nsh` 在安装器初始化时，将仅限该进程及其子进程的 TEMP/TMP 设为 Windows 扩展长度路径（`\\?\`，UNC 使用 `\\?\UNC\`）。旧卸载器无需替换即可使用长路径。完成安装、启动应用前恢复原始 TEMP/TMP；不修改注册表中的系统环境变量或 LongPathsEnabled，不删除用户数据，不绕过应用关闭检查、卸载退出码或失败回滚。

## 回归证据

- `npm run test:installer`：使用实际 NSIS 编译的父/子程序；修复前旧文件移动失败（73），修复后成功。覆盖移动正文完整性、已有扩展前缀、原始 TEMP 与 TMP 不同、失败退出码保留及环境恢复。
- `npm run test:installer-upgrade`：使用独立 appId 和安装目录生成小型真实 NSIS 安装包。安装 1.4.2 测试夹具，直接执行旧卸载器的升级移除复现失败并验证回滚；通过修正版安装器覆盖升级到 1.4.3，确认实际独立 APPDATA 目录中的哨兵文件保留；验证普通卸载成功。
- Windows 发布流水线在生成安装包后运行这两项检查，失败会阻止公开 release。
- 原始日志保存在 `artifacts/installer-diagnosis/`；最终升级专项日志为 `upgrade-test-ci.log`。测试创建 artifacts 目录，并使用受控长度 TEMP，避免 CI 用户名不同导致未覆盖失败条件。
- 依赖构建结束后的有效全量复核：317 文件、2,385 项通过，17 文件、62 项跳过（117.51 秒，`tests-final.log`）。
- 新生成的 Windows 成品完整桌面冒烟通过（`smoke.log`，`Packaged Electron smoke test passed.`）；DSH 包内 27,807 个资源及 Node 校验通过。

测试夹具使用当前锁定的 electron-builder/NSIS 生成，不等同于在每种 Windows 系统上安装历史正式包。真实 UAC 跨账户提升和 UNC 临时目录尚未专项验证。

第一次应用全量测试与 DSH 打包脚本的 `npm ci` 并行运行，依赖被重建时出现大量 DSH 失败；该次检查已中止且不作为有效验证。后续单 worker 重跑长期未出结果，亦已中止。最终按项目默认四 worker 完整重跑通过，见上方结果。

本地修正版使用较快的压缩等级 1，从已验证的同一 win-unpacked 目录生成；只影响包大小和压缩时间，不更换应用内容。原压缩等级 9 的打包过程主动中止，记录保留在 `package.log`；最终打包日志为 `package-final.log`。

## 本地交付

`dist/installer-fixed/ChouYu-Setup-1.4.3-fixed.exe` 构建成功，319,659,019 字节，已复制到用户下载目录。复制后 SHA-256 一致，记录为 `installer-fixed-integrity.json`。这是本地修正版普通安装包，不需要额外启动脚本；未发布或替换 GitHub 正式附件，未自动升级用户现有的 1.4.2。
