# ChouYu 1.4.2 发布验证

日期：2026-10-26。此前可靠性改进、回复竞态修复及全部失败记录见 [1.4.1 验证记录](release-checklist-v1.4.1.md)。`v1.4.0` 质量检查失败；`v1.4.1` 正式质量检查通过，但 macOS universal 打包失败，随后取消发布，草稿未公开。保留原标签，正式候选顺延到 1.4.2。

macOS 打包发现检查点依赖额外带入 better-sqlite3 12 的旧 ABI 文件。项目业务一直将根依赖 better-sqlite3 13 创建的连接传给 SqliteSaver；现在通过作用于检查点包的 override 统一到根依赖，移除嵌套 v12 和不再需要的安装依赖，不扩大 universal 文件豁免。干净安装确认只有 better-sqlite3 13.0.3；新增依赖解析一致性及 SqliteSaver 自建连接的持久化回归，先复现嵌套依赖，再验证通过。双平台发布流程增加使用成品 Electron 执行的检查点写入、关闭及重读验证；macOS 同时检查两种 Darwin 预编译文件存在。

恢复界面窄屏验收曾错误地只缩小模拟视口，浮动工作区仍按既有约定保留 728px 宽度。测试现通过真实最大化入口建立窄屏前提，保留 375/1024px、亮暗主题、表单边界及全部存储恢复断言；失败时记录几何和截图，继续抛出原错误。成品验证通过，未修改产品窗口行为。日志：`chouyu-recovery-diag-packaged.log`、`chouyu-recovery-diag2-packaged.log`、`chouyu-recovery-max-packaged.log`。

同一提交的 master 质量任务曾出现多项 5/10 秒测试或清理超时及临时文件 rename EPERM；正式标签质量任务全部通过。保留 `chouyu-release141-master-final-failed.log`，不扩大超时，也不宣称环境问题已根治。

本地最终类型检查通过，全量 284 个测试文件、2199 项通过，61 项跳过（75.24 秒）；应用与独立 DSH 运行时审计均为 0。新 Windows 成品的 SQLite 检查点关闭重读及完整联系人恢复回归通过。探针由 Node 等待成品子进程并检查完成标记，限制依赖解析在 app.asar 内；使用错误目录的负向验证明确失败。日志为 `chouyu-release142-tests.log`、`chouyu-release142-sqlite-packaged.log`、`chouyu-release142-probe-negative.log`、`chouyu-release142-recovery.log`。

独立审查确认 SQLite 统一方案与窄屏测试前置条件合理。最终全量结果和双平台成品验证以 `v1.4.2` 对应 Actions 为准；两平台全部成功后才允许公开草稿。干净系统安装/卸载、macOS 人工交互、全天常驻及真实断电均不在本次已完成证据内。其余已知限制继续见发布说明。
