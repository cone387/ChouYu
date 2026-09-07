# 1.3.0-rc.3 本地候选包

生成时间：2026-09-07。未上传、未发布，不能作为正式版发布完成的依据。

- 安装包：`dist/iteration-1.3.0-rc.3/ChouYu Setup 1.3.0-rc.3.exe`
- 大小：122,539,355 字节。
- SHA-256：`69530628492c97cb9b3587d85aad7cf1b30a76c0d7e1300f4660fcc620b1c0fb`
- 同目录包含 `SHA256SUMS.txt` 和更新 blockmap。
- Electron 44.2.0，Windows x64，Node 24 工具链。
- 包内程序实际运行通过 SQLite/旧数据迁移、保存失败与重试、GFM、全文搜索、流式滚动、设置入口、记忆 CRUD、授权键盘和真实离线 OCR 冒烟，日志确认 `version=1.3.0-rc.3 packaged=true`。
- 集成 `rc.2` 后的记忆提取修正、Mem0 异步确认/隔离/历史/归档/冲突/清空，以及退出搜索后的虚拟列表定位修复。包内 Mem0 使用本地协议服务验证故障和恢复；独立真实服务报告另见 `provider-acceptance.md`。
- 255 项单测、类型检查、带标注记忆基线、完整依赖审计（0 项）通过。包内截图在 `temp/rc3-ui`，包括亮暗与 375/1024 等效视口；已复核窄屏聊天和设置截图。

复现打包：

```powershell
npm ci
npx install-electron --no
npm run build
npx electron-builder --win --publish never --config.directories.output=dist/iteration-1.3.0-rc.3 --config.electronDist=node_modules/electron/dist
# 完成打包后再运行；--ocr 需要本机安装 Windows OCR 语言包
node scripts/smoke-electron.js --packaged dist/iteration-1.3.0-rc.3/win-unpacked/ChouYu.exe --ocr
```

本机下载使用官方 Electron release 文件，并比对 npm 包所附 SHA-256 后使用。打包器复用已校验的本地 Electron，避免重复下载。

已保留 `rc.1` 作为前一候选包，它不含后续 OCR 和授权键盘改进。`rc.2` 首次包内测试与 NSIS 压缩并行运行时，第二次 OCR 的 UI 等待超过 5 秒；压缩结束后的独立复测通过。此记录保留为高负载下的测试时限问题，不能把一次独立复测推广为高负载性能保证。

## 签名与正式发布条件

`rc.2` 完整保留，SHA-256 为 `1bb62ee1ce1f8245858fd49fe913db428eb305daba3ece3ed1ebff0e9479088f`，122,535,180 字节。`rc.3` 在压缩完全结束后单独运行包内验收，通过且未重试。

本候选安装包及应用 EXE 的 Authenticode 状态均为 `NotSigned`，限内部验证。未配置、申请或购买代码签名证书。

正式公开发布前需要由维护者提供代码签名身份，以 CI 密钥/签名服务保存凭据，在发布构建启用 `forceCodeSigning`，验证安装包与应用签名和时间戳后再发布。不能仅凭构建日志中的“signing”字样判断已签名。macOS 签名、公证和实机测试另行验收。

未完成的外部验证：干净 Windows 的安装/卸载/升级/开机自启、真实 AI/BBTalk 服务、物理多显示器与 DPI。当前机器没有现成 Hyper-V 虚拟机；隔离 userData 冒烟不能代替干净系统验证。完整范围见 [迭代验收](iteration-acceptance.md)。
