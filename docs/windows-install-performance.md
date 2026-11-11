# Windows 安装性能

## 变更

1.4.5 的发布复制步骤排除 `.d.ts`、`.d.mts`、`.d.cts` 及 JS/TS 源码映射。运行时 TypeScript、普通 `.map` 资源、文档、许可证、原生组件及全部功能依赖继续保留。开发用 `runtime/dsh/node_modules` 不受裁剪影响。

固定依赖版本的运行时从 27,807 个文件、600,817,723 字节，减至 14,821 个文件、521,893,035 字节；减少 12,986 个文件（46.7%）和 78,924,688 字节。

不改变 NSIS 安装/卸载行为和增量更新格式。直接切换 ZIP 解压会要求关闭 differentialPackage，并改变解压失败处理，因此本轮不采用；旧版本升级仍会先处理旧版完整文件集合。

## 验证方式

- `npm run test:runtime-packaging` 验证真实复制结果、执行发布后的模块、读取资源和保留许可证；同时验证开发依赖未被删除。普通 CI 与发布 CI 均运行。
- 完整构建后执行清单/Node 校验、成品桌面和 DSH 冒烟。
- `node scripts/benchmark-windows-installer.cjs <win-unpacked目录>` 构建独立应用标识的完整负载安装器，使用相同应用和依赖对比全部复制与裁剪复制。先核对锁文件和保留依赖的逐字节一致性，记录首次安装、旧负载升级到新负载、新负载首次安装和卸载耗时；检查数据哨兵保留、安装资源完整和无旧文件残留。
- 基准使用独立 EXE 名称、注册表、安装目录及 APPDATA，不操作现有 ChouYu 安装。原始结果写入 `artifacts/install-speed-*/results.json`。这是单机测量，不能推导所有机器的耗时。

## 本次记录（2026-11-11）

- 新复制测试先在未裁剪实现上因 `index.d.ts should not ship` 失败，修改后通过。
- 类型检查、模块边界检查通过；全量 317 文件、2,385 项通过，17 文件、62 项跳过（120.87 秒）。
- 打包运行时清单验证通过，14,821 个文件；14,811 个保留依赖文件与开发依赖逐字节一致。
- 第一次成品 DSH 冒烟与两项压缩同时执行，失败于 `DSH 控制请求超时（ready）`，继而等待 persistent confirmation 超时。该次失败保留在 `artifacts/installer-diagnosis/speed-dsh-smoke.log`，尚不能归因于负载，需单独复测。
- 同一成品未修改代码，独立 DSH 启动探针 901ms 成功；完整 DSH 成品复测通过（`speed-dsh-smoke-recheck.log`）。复测时仍有一项压缩运行，不能据此确认首次超时原因。
- 首次完整桌面冒烟失败于 `window.__floatingMouseIgnored === false` 的状态等待，日志 `speed-smoke.log` 保留；新成品 `out/main/index.js` 与 `out/preload/index.js` 已与本机正式 1.4.4 成品逐字节比对一致，界面测试失败不作为本次已修复问题。
- 未改变代码的完整桌面复测通过（`speed-smoke-recheck.log`）。
