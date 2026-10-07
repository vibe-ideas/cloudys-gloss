# 0.1.1：科技音标补缺与按需词典

本次保留原有 ipa-dict US 和 Britfone UK，在此基础上补充经过来源核对的科技词条，并将整库加载改为有序分片读取。没有更换模型或生成音标，AI 释义策略不变。

## 数据与展示

考察 195 个技术词、基础编程词和名称的 Kaikki 逐词原始 JSONL，126 个返回了 IPA；经过标签筛选、去重和已有词条排除，最终发布 47 个补缺条目。仅使用完整的宽式 IPA，不采用带缩写连字符、备注、戏谑、受批评或未支持地区标签的变体。审核中额外排除了 `parsing` 和 `recursion` 两条辅音可疑的上游记录，未擅自修正它们。

US / General-American 进入美式列，UK / Received-Pronunciation 进入英式列；没有口音标签的记录进入独立 `general` 字段，UI 标为“词典未标注口音”。不能从相邻音频标签推断 IPA 的口音。

例如 `latency`、`throughput`、`CPU` 补齐了英式音标，`JSON` 补充双口音，`Kubernetes` 和 `YAML` 显示来源保留重音的未标注口音 IPA。基础库已有读法保持优先，补充库不覆盖。`LLM`、`GPU` 等缺少可采用 IPA 的词依然可能显示“音标暂无”，系统发音按钮仍可使用。

47 个条目的运行时 JSON 为 3,748 字节，gzip 1,136 字节。来源清单和许可也随包分发，两者分别为 24,594 / 1,156 字节；它们不在划词时加载。

归档来源：[technology-sources.json](../../data/pronunciation/technology-sources.json)。来源摘录采用 Wiktionary 数据许可，提取和过滤说明见随包 [technology-license.txt](../../public/dictionaries/technology-license.txt)。这是保守的来源/转写审阅，不是全体读音准确率的独立专家认证。

## 固定语料覆盖

沿用 [101 项科技诊断语料](../../tests/performance/dictionary-tech-corpus.json)，该语料参与了补缺选词，不作为独立盲测。统计只表示有无对应音标，不表示产品名语义或上下文多音选择的准确率。

| 指标 | 升级前 | 升级后 |
| --- | ---: | ---: |
| 有美式音标 | 51/101 | 55/101 |
| 有英式音标 | 32/101 | 42/101 |
| 至少有一种音标，包括明确标为未注明口音的 IPA | 52/101 | 60/101 |

未标注口音的音标没有算入 US / UK。分组统计见 [upgrade-coverage.json](data/2026-10-07-dictionaries/upgrade-coverage.json)。通用词库的总规模不变，这次是定向补缺，不能宣称已覆盖整个科技领域。

## 资源和验证

构建将原有两个 TSV 分成 128 个排序区间，生成一个小索引。发布包移除原始整库文件，避免保存两份相同词典；源码仍保留原始 TSV，方便复核。所有分片拼接后逐字等于原库，区间首尾查询与基线逐一对比通过。

后台共享索引和补充库，资产加载最多并行两个，已加载的分片按 UTF-16 文本载荷限制为 768 KiB，按最近使用顺序淘汰。这个上限不是扩展堆内存或进程 RSS；索引、补充库对象、响应和 GC 临时内存另计。单个调用取消不影响其他等待者，文件暂时不可读后可以重试。

Chrome / Firefox 的真实扩展 E2E 在模型队列被占用时点击划词按钮，观察音标出现：

| 词条 | Chromium | Firefox Developer Edition |
| --- | ---: | ---: |
| latency | 322 ms | 268 ms |
| Kubernetes | 319 ms | 266 ms |

每个场景每浏览器一次；时间包含 Playwright 点击和可见性断言开销，不是纯字典查询延迟，也不是 P95。使用真实随包词典，模型响应是受控测试服务；这不是译文质量测试。原始报告：[extension-e2e.json](data/2026-10-07-dictionaries/extension-e2e.json)。分片布局的重复微基准见 [前置调研](../research/2026-10-07-lightweight-dictionaries.md)。

验证完成：lint、typecheck、340 项单测通过；22 项 Chromium / Firefox E2E 通过。新增测试覆盖并发共享、取消隔离、缓存淘汰、读取失败恢复、来源哈希及口音标签、基础音标不被覆盖，以及未标注口音 IPA 在 AI 词卡补齐后的保留。Firefox 截图已检查，无卡片越界和文字重叠。

本地更新沿用原扩展 ID `cloudys-gloss@local.dev`，版本提升为 0.1.1，不要求卸载旧版或清空设置。安装状态另以实际浏览器确认结果为准，打包和测试完成不等于日常 profile 已更新。

本轮执行了 `pnpm update:firefox`：检查、构建、XPI 验证和向 Firefox 打开安装请求均成功。安装包位于 `.output/local-install/cloudys-gloss-0.1.1-firefox-unsigned.xpi`，SHA256 为 `cd6b5816905781531eb29ccc5ca1e1cf66d2d560ff8053d28acf6d1e49c1a926`。自动化读取日常 Firefox 窗口返回 `cgWindowNotFound`，无法操作或确认最后的更新提示；没有声称日常 profile 已完成更新。需要在 Firefox 提示中完成确认，或通过附加组件管理器选择该文件更新。
