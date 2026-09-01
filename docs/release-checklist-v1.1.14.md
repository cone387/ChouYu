# ChouYu 1.1.14 发布检查清单

检查日期：2026-08-31

状态：本地发布候选。已生成 Windows x64 安装包和更新元数据，尚未创建 Git Tag、GitHub Release 或完成真实用户环境验收。

## 已自动验证

- [x] `npm run typecheck`
- [x] 21 个 Vitest 测试文件、89 项测试
- [x] `npm run build`
- [x] 开发产物 Electron 启动冒烟测试
- [x] Windows x64 unpacked 产物生成
- [x] Windows NSIS 安装包生成
- [x] packaged Electron 启动冒烟测试（沙箱外真实进程）
- [x] 冒烟测试使用临时用户目录，不读取或覆盖真实用户配置

## 构建产物

- 安装包：`dist/ChouYu Setup 1.1.14.exe`
- 安装包大小：`92,736,019` bytes
- 安装包 SHA-256：`DAD0E268F020EDD5565D52FFD9AA2E3BEA604F5FB2A9B9C0BC5EC5FDF604B41D`
- Blockmap：`dist/ChouYu Setup 1.1.14.exe.blockmap`
- 更新元数据：`dist/latest.yml`
- Unpacked：`dist/win-unpacked/ChouYu.exe`
- 代码签名：未配置，electron-builder 已跳过签名

## 发布前人工验收

- [ ] 在干净 Windows 用户环境完成安装、首次启动和卸载
- [ ] 检查桌面快捷方式、安装目录选择和卸载残留
- [ ] 验证透明窗口、点击穿透、拖拽、吸附和窗口层级
- [ ] 验证 Alt+Space、自定义快捷键和快捷键冲突恢复
- [ ] 验证托盘显示/隐藏、设置和退出
- [ ] 验证开机自启启用、禁用和重启后的行为
- [ ] 验证一个 OpenAI-compatible 服务的模型获取、流式聊天、停止和重试
- [ ] 验证 Claude 官方接口的模型获取和流式聊天
- [ ] 验证图片/文本附件、文件拖拽、区域截图和窗口截图
- [ ] 验证 100% / 125% / 150% DPI 与多显示器面板定位
- [ ] 验证 BBTalk 登录、Token 刷新、发布和退出登录
- [ ] 创建预发布 GitHub Release 后验证 `latest.yml` 和应用内自动更新
- [ ] 决定并配置 Windows 代码签名证书

## 发布动作

以下动作涉及远端仓库和公开发布，需要单独确认后执行。

- [ ] 提交并推送 `1.1.14` 发布候选改动
- [ ] 创建 `v1.1.14` Git Tag
- [ ] 推送 Tag 触发 GitHub Actions Release 工作流
- [ ] 检查 GitHub Release 资产和更新元数据
