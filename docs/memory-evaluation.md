# 长期记忆评测

运行 `npm run test:memory-eval`。语料在 `tests/fixtures/memory-evaluation.json`，评测脚本在 `scripts/evaluate-memory.mjs`。数据为合成样例，不含用户对话。失败时打印样本 ID、预期和实际值，并以非零状态退出；CI 已加入此命令。

2026-09-07 扩充后的本地基线：

| 范围 | 样本 | 结果 |
| --- | ---: | --- |
| 规则提取 | 30 | Precision 100%，Recall 100%；TP 13、FP 0、FN 0；置信度上限违规 0 |
| 关键词排名 | 10 | Recall@3 100% |
| 冲突/更新判断 | 8 | Accuracy 100% |

提取覆盖身份、偏好、项目、工作方式，以及问题、假设、玩笑、第三方转述、密钥和临时请求等负例。冲突覆盖姓名/事实变化、相反偏好、重复与不相关内容。

扩充语料在修复前复现了四项失败：两个呼叫/命令句被误当姓名，没有问号的疑问句被误当偏好，以及“请记住”使不确定表述获得 0.96 置信度。现已修正并保留为回归样例。置信度约束单独计数，不将分类正确但置信度错误混入提取 Precision/Recall。

## 真实模型提取

已使用本机应用配置的 OpenAI 兼容服务、`deepseek-v4-flash`、temperature=0 执行合成语料。没有发送用户历史对话。语料为 `tests/fixtures/memory-live-evaluation.json`。

| 运行 | 严格样本通过率 | 请求失败 | 失败案例 |
| --- | --- | --- | --- |
| [首轮](evaluations/memory-live-2026-09-07.json) | 15/16，93.75% | 0 | 工作方式错分为偏好 |
| [明确类型定义后](evaluations/memory-live-2026-09-07-revised.json) | 15/16，93.75% | 0 | 不确定偏好未忽略，而是生成 0.5 置信度候选 |
| [相同提示词复测](evaluations/memory-live-2026-09-07-repeat.json) | 15/16，93.75% | 0 | 姓名之外额外推断出一条称呼偏好，标为 inferred、置信度 0.7 |

评判同时要求数量、类型和关键事实匹配，额外推断也算失败。后两轮错误候选未达到自动写入阈值，但仍影响候选质量，所以保留失败记录，不修改标签以求通过。提示词已明确工作方式的类型定义；温度为 0 也没有消除观察到的波动。

复现命令（会向已配置服务发送合成语料，产生正常 API 用量）：

```powershell
node scripts/evaluate-memory-live.cjs "$env:APPDATA/chouyu/chouyu-data.json" docs/evaluations/memory-live-new-run.json
```

评测读取连接配置，在隔离 Electron profile 中使用系统解密；Windows 仅复制 `Local State` 的加密元数据，不复制浏览器历史。报告不输出密钥。失败以非零状态退出；此命令未加入默认 CI。后续报告包含提取器 SHA-256，上述三次早期报告没有该字段，需结合本表提示词阶段解释。

这仍是小规模评测，不能代表泛化能力。关键词召回样例不是语义召回评测；本地独立 Embedding 未配置，因此没有对应实测。远程 Mem0 的同义、跨语言、时间和主体混淆评测见下节。

## 真实 Mem0 召回与回答依据

固定语料 `tests/fixtures/mem0-recall-evaluation.json` 包含 12 条合成记忆和 14 个问题，覆盖同义改写、英文查询、同名近音、用户/朋友、当前/过去、多个项目，以及两个无答案问题。每次使用随机隔离用户，上传时 `infer=false`，不让服务重新提取并改变标签。测试完逐条校验并删除合成数据，两轮清理均成功。

| 指标 | 结果 | 含义 |
| --- | --- | --- |
| 有答案问题的平均 Recall@3 | 100%，12/12 查询覆盖全部目标 | 能找到标注记忆 |
| 有答案问题的 MRR | 1.0 | 每个问题首位结果均相关 |
| 有答案问题的平均 Precision@3 | 36.11% | 返回的 3 条中仍有较多干扰项 |
| 无答案时检索返回空集 | 0/2 | 猫名、生日问题都返回了无关记忆 |
| 回答依据选择（规范化引用前缀后） | 14/14 | 正确选择人物/时间/项目依据；两个无答案样例均 UNKNOWN |

报告：[原始召回](evaluations/mem0-recall-2026-09-07.json)、[含回答依据的复测](evaluations/mem0-recall-evidence-2026-09-07.json)。原始检索仍按严格无答案拒绝标准标记 `passed=false`，命令退出码为 1，不用回答阶段表现覆盖这一失败。

回答测试调用当前模型 `deepseek-v4-flash`，使用应用的 `formatMemoryContext`，额外要求输出简短答案及依据 ID，衡量依据选择而非开放式答案的全面正确性。9 个样例保留了显示格式中的 `memory:` 前缀，严格格式评分为 5/14；仅移除此固定前缀后为 14/14。[离线复核报告](evaluations/mem0-recall-evidence-normalized-2026-09-07.json) 保留原引用与源报告哈希，未更改答案或预期标签。

应用提示词已明确“检索候选可能无关、排序不是可信度、区分人物与时间、没有依据时不编造”。没有根据这两个负例硬调全局相似度阈值；不同服务的分数分布尚未校准。上述结果不是普通聊天的 100% 正确率保证，仍需更大样本与独立留出集。

复现（显式远端评测，不加入默认 CI）：

```powershell
node scripts/evaluate-memory-live.cjs "$env:APPDATA/chouyu/chouyu-data.json" docs/evaluations/mem0-recall-new.json --recall
node scripts/evaluate-memory-live.cjs "$env:APPDATA/chouyu/chouyu-data.json" docs/evaluations/mem0-evidence-new.json --recall --answer-evidence
node scripts/normalize-memory-evidence.cjs docs/evaluations/mem0-recall-evidence-2026-09-07.json docs/evaluations/evidence-rescored.json
```
