# ChouYu 0.6.0 发布检查清单

检查日期：2026-08-27

状态：发布候选。当前未创建 `v0.6.0` Git 标签，也未发布 GitHub Release。

## 已自动验证

- [x] `npm run typecheck`
- [x] 27 项 Vitest 单元测试
- [x] `npm run build`
- [x] 开发产物 Electron 启动冒烟测试
- [x] Windows x64 unpacked 产物生成
- [x] Windows NSIS 安装包生成
- [x] 打包产物 Electron 启动冒烟测试
- [x] 冒烟测试使用临时用户目录，不读取或覆盖真实用户配置

## 构建产物

- 安装包：`dist/ChouYu Setup 0.6.0.exe`
- 安装包大小：79.06 MB
- 安装包 SHA-256：`4B45F17A1D365EEAF055D432ED126E2A603C20A73581D5296CEA9445B790D62C`
- 更新元数据：`dist/latest.yml`
- Blockmap：`dist/ChouYu Setup 0.6.0.exe.blockmap`
- 代码签名：未配置，electron-builder 已跳过签名

## 发布前人工验收

- [ ] 在干净 Windows 用户环境完成安装、启动、卸载
- [ ] 检查桌面快捷方式、安装目录选择和卸载残留
- [ ] 验证透明窗口、点击穿透、拖拽、吸附和窗口层级
- [ ] 验证 Alt+Space、自定义快捷键及快捷键冲突恢复
- [ ] 验证托盘显示/隐藏、设置和退出
- [ ] 验证开机自启启用、禁用和重启后的行为
- [ ] 验证一个 OpenAI 兼容服务的模型获取、流式对话、停止和重试
- [ ] 验证 Claude 官方接口的模型获取与流式对话
- [ ] 验证图片附件、文本附件、文件拖拽和区域截图
- [ ] 验证 100% / 125% / 150% DPI 与多显示器面板定位
- [ ] 验证 BBTalk 登录、Token 刷新、发布和退出登录
- [ ] 创建预发布 GitHub Release 后验证 `latest.yml` 与应用内自动更新
- [ ] 决定是否配置 Windows 代码签名证书

## 发布动作（需明确授权后执行）

- [ ] 提交并推送 `0.6.0` 发布候选改动
- [ ] 创建 `v0.6.0` Git 标签
- [ ] 推送标签触发 GitHub Actions Release 工作流
- [ ] 检查 GitHub Release 中 Windows、macOS 与更新元数据是否齐全
