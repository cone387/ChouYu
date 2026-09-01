# ChouYu 1.1.15 发布检查清单

检查日期：2026-09-01

状态：本地发布候选。Windows x64 安装包、更新元数据和 packaged 启动验证已完成；尚未创建 Git Tag 或 GitHub Release。

## 已自动验证

- [x] `npm run typecheck`
- [x] 22 个 Vitest 测试文件、91 项测试
- [x] `npm run build`
- [x] Windows x64 unpacked 产物生成
- [x] Windows NSIS 安装包生成
- [x] packaged Electron 启动冒烟测试
- [x] 托盘 PNG 非空保护、默认人格迁移和 UI 状态恢复回归测试

## 构建产物

- 安装包：`dist/ChouYu Setup 1.1.15.exe`
- 安装包大小：`92,739,835` bytes
- 安装包 SHA-256：`B45954E5946A1936E45260201FC624AA70E17012F0315945DA9C82E4D83AECB4`
- Blockmap：`dist/ChouYu Setup 1.1.15.exe.blockmap`
- 更新元数据：`dist/latest.yml`
- Unpacked：`dist/win-unpacked/ChouYu.exe`
- 代码签名：未配置

## 本轮人工 UI 验收

Windows UI 控制服务当前不可用，以下项目需要人工确认：

- [ ] 完全退出并重启后，托盘显示紫色宠物图标且不透明
- [ ] 调整聊天面板高度，关闭并重新打开后高度保持
- [ ] 会话列表展开/收起状态在重启后保持
- [ ] 使用旧默认人格的本机配置升级为新版人格，自定义人格不被覆盖
- [ ] 会话切换不改变列表卡片顺序，菜单按钮与时间右边界对齐

## 发布动作

- [ ] 提交并推送 `1.1.15` 发布候选改动
- [ ] 创建 `v1.1.15` Git Tag
- [ ] 推送 Tag 并检查 GitHub Release 资产
- [ ] 使用已发布的 `latest.yml` 验证应用内更新
