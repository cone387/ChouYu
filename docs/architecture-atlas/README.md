# ChouYu 系统与模块架构图册

18 张基于源码整理的架构图，覆盖系统全景、进程边界、前端、聊天、联系人任务、执行与调度、助手安排、用户待办、消息投递、日志、记忆、扩展、感知、搜索、存储、配置和应用生命周期。

先打开 [图册目录](index.html) 或 [系统架构总览](system.html)，点击图中模块继续展开。请将仓库检出到本地后，用浏览器打开 HTML；GitHub 文件预览不会直接渲染这些页面。无需启动应用、安装插件或联网。窄屏下图面可以横向滚动，打印时自动缩放。字体使用本机回退，不同系统的字形可能不同。

每页均提供阅读说明、范围边界、源码链接和核对版本。源码链接指向当前检出文件；完整核对记录位于 [source-snapshot.json](source-snapshot.json)。图册是静态源码说明，不能替代运行验收或产品规范；联系人任务以 [现行规范](../contact-task-spec.md) 为准，早期规划保留在 [architecture.md](../architecture.md)。

## 文件与维护

| 文件 | 用途 |
| --- | --- |
| `build_atlas.py` | 图内容、节点连线、源码入口与页面布局的编辑入口 |
| `atlas_primitives.py` | 仓库内独立维护的 SVG 图元及离线样式 |
| `*.html`、`atlas-manifest.json` | 生成结果，与生成器一起提交；不要直接修改 |
| `source-snapshot.json` | 人工核对日期、Git 提交及引用源文件的内容摘要 |
| `source_snapshot.py` | 记录核对基线，检测引用源文件是否变化 |
| `verify_atlas.py` | 检查生成一致性、来源、链接、SVG 与浏览器布局 |

在仓库根目录运行，要求 Python 3.10 或更新版本。生成与静态检查只用标准库：

```sh
python docs/architecture-atlas/build_atlas.py
python docs/architecture-atlas/build_atlas.py --check
python docs/architecture-atlas/verify_atlas.py --static-only
```

`--check` 只检查，不覆盖文件。生成器不会自动更新核对日期和 Git 版本。正式图册不依赖本机的六图效果示例；示例目录保留在本地并由 `.gitignore` 排除。

## 架构发生变化时

1. 对照变动源码和产品规范，核对受影响的图，更新 `build_atlas.py` 中的内容、边界和来源；新增模块也应人工检查是否需要纳入。
2. 运行生成器更新清单。源代码提交后，明确记录已核对的源码版本（日期填写实际核对日期）：

   ```sh
   python docs/architecture-atlas/source_snapshot.py --record-review HEAD --date YYYY-MM-DD
   python docs/architecture-atlas/build_atlas.py
   ```

3. 运行静态检查与下面的浏览器检查，查看受影响的截图，将生成器、来源记录和生成结果一起提交。

来源检查会报告引用文件变化，即使变化不影响架构；核对后才更新记录。它只比较已列出的来源，不会自动理解源码，也不会发现所有新增文件或判断图意是否准确。记录基线要求这些源文件与指定 Git 版本一致。其他文档或图册自身尚未提交不影响记录。

## 浏览器布局检查

可选 QA 依赖与应用依赖分开安装：

```sh
python -m pip install -r docs/architecture-atlas/requirements-qa.txt
python -m playwright install chromium
python docs/architecture-atlas/verify_atlas.py
```

已有 Chromium 或 Chrome 时，可用 `--browser-executable "浏览器可执行文件的完整路径"` 指定，脚本中不保存机器路径。生成和阅读 HTML 均不需要 Playwright。

完整检查覆盖 19 个页面的桌面与手机宽度、SVG 文本边界、连线穿越节点、标签遮挡、节点数量及打印缩放。截图和 `results.json` 默认写入 Git 已忽略的 `artifacts/architecture-atlas/`，可用 `--output` 更改；截图供人工查看，不作为正式文档重复提交。
