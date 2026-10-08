# 科技阅读离线词典：覆盖、速度与开销

2026-10-07，Apple M4 Pro。本轮调研与原型基准未替换插件的生产词典或查询方式。

建议保留现有音标基础库，优先补充带来源的科技词条；需要扩大覆盖时，在构建阶段从 Wiktionary 提取保留重音、口音标签的数据。运行时采用有序分片与有上限的缓存，是值得进入扩展集成测试的方向。没有发现同时满足“科技覆盖全面、双口音标注可靠、体积小”的现成替代库。

当前词典的纯查询已经很快。换词典不会消除 AI 词卡数秒的生成等待；词典能先提供音标和可靠的基础解释，模型随后提供语境解释。

## 实际下载的数据

使用固定 revision 下载数据，SHA256、文件大小与逐词命中保存在 [coverage.json](../performance/data/2026-10-07-dictionaries/coverage.json)。完整上游数据和分片只放在被 Git 忽略的 `artifacts/dictionary-research-2026-10-07/`，不进入扩展包。

| 数据 | 去重后的词条数 | 本次音标抽样命中 / 101 | 精简音标文本 gzip | 判断 |
| --- | ---: | ---: | ---: | --- |
| 现有 ipa-dict US | 125,927 | 51 | 872 KB | 保留为基础库 |
| 现有 Britfone UK | 15,212 | 32 | 106 KB | 轻量，但英式覆盖不足 |
| CMUdict 当前快照 | 126,052 | 51 | 908 KB | 与现有美式数据同源，抽样没有新增命中；原数据是 ARPAbet，需要转换 |
| WikiPron US broad | 79,307 | 54 | 705 KB | 有新增科技词，但现成文件没有重音标记 |
| WikiPron UK broad | 79,884 | 50 | 701 KB | 明显补充英式词条，但不能直接当作完整学习音标替换 |
| ECDICT 非空 phonetic 字段 | 218,065 | 45 | 1,909 KB | 词条多不等于科技音标覆盖高；没有独立 US / UK 字段 |

KB / MB 使用十进制。gzip 是统一格式的压缩对比，不是实际 XPI 包体积。CMU 保留 ARPAbet，ECDICT 保留原音标，WikiPron 合并同词变体并移除音素间分隔空格；这些是测量副本，不是经过语言学审核的可发布资产。

抽样沿用上一轮选定的 [101 个科技词、产品名、缩写和短语](../../tests/performance/dictionary-tech-corpus.json)，不是随机语料或文章词频加权覆盖率。大小写统一后精确匹配，与现有查询的这部分行为一致。命中仅表示字符串词头存在，不等于义项、读音或产品名称正确。该清单是覆盖诊断语料，不是已经标注正确答案的质量用例。

### WikiPron：适合做提取工具，不适合直接搬现成 TSV

与现有库相比，这份 US 文件新增命中 `concurrency`、`Kubernetes`、`TypeScript`、`Wasm`、`JSON`、`YAML` 等，但也缺少现有库的一些条目。UK 文件从 32/101 提高到 50/101。两份文件均没有 `ˈ` / `ˌ` 重音标记，不能为了补齐音标而忽略这个损失。

另一个限制来自提取规则：WikiPron 的口音筛选仍会纳入没有口音标签的记录。所以文件名包含 US / UK，并不保证每条变体都得到相应口音的明确标注。见 [WikiPron README](https://github.com/CUNY-CL/wikipron#specifying-the-dialect)。正式接入需要保留原始标签，未指定口音的记录不能自动填到两列。

### ECDICT：可以补一般中文释义，但科技语境必须审核

固定 CSV 有 770,611 个小写去重词头，其中 768,739 个有中文释义，218,065 个有音标。释义字段在本次抽样中命中 71/101，音标只命中 45/101。以下是从下载文件中直接读到的义项：

| 输入 | 数据里的释义 | 科技阅读的问题 |
| --- | --- | --- |
| GPU | 地面动力装置（ground power unit） | 不是图形处理器 |
| LLM | 法学硕士；法律硕士 | 不是大语言模型 |
| typescript | 用打字机打的文件 | 不能作为 TypeScript 语言的解释 |
| docker | 码头工人 | 不能作为 Docker 软件的解释 |
| embedding | 埋置、包埋、嵌铸、植入等 | 没有给出机器学习中的向量表示含义 |
| transformer | 变压器、促使变化的人 | 没有给出模型架构含义 |

这也说明缩写大小写、产品名与普通名词的区分应成为后续质量测试的一部分。不能把词典命中直接当作最终解释，或无条件塞给模型作为正确答案。

原始 CSV 65.93 MB；只保留词头、音标、中文释义，紧凑 JSONL 仍为 45.15 MB，gzip 15.46 MB。按上游已有频率或标签筛选可得到 59,137 条，文本 4.21 MB、gzip 1.68 MB；这个规则没有使用测试词表，但也没有验证科技语义覆盖，不能宣称得到了一份可靠的科技词典。字段与许可证见 [ECDICT](https://github.com/skywind3000/ECDICT) 和 [LICENSE](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE)。

## 其他候选的适用范围

| 候选 | 调研结论 |
| --- | --- |
| Wiktionary / Kaikki 原始结构化数据 | 优先考虑作为构建数据源。可提取音标、标签、义项；不能直接打包完整数据。当前英文展示页的后处理数据约 3.1 GB，且该下载格式已标注将废弃；新流程应使用原始 Wiktextract 数据。完整原始数据包含多语言，需先筛 English。本轮没有下载或测量完整原始库。 |
| wiki-pronunciation-dict | 仓库已归档；其处理会简化音素、去掉部分超音段信息，输出也不独立保存 US / UK。适合其他语音研究用途，不作为此词卡的首选。 |
| Wordset | 项目已结束运营，数据主要是英文解释；不解决双口音音标和当代科技词条的问题。 |
| eSpeak NG / G2P | 可用于未收录词的推测读法，但需要区分“预测”和“词典记录”，尤其是缩写与产品名。本轮未做模型大小、启动耗时或准确率测试，不建议现在新增推理依赖。 |

来源：[Kaikki 英文页](https://kaikki.org/dictionary/English/index.html)、[原始数据下载](https://kaikki.org/dictionary/rawdata.html)、[wiki-pronunciation-dict](https://github.com/DanielSWolf/wiki-pronunciation-dict)、[Wordset](https://github.com/wordset/wordset-dictionary)、[eSpeak NG](https://github.com/espeak-ng/espeak-ng)。

词典提取工具的代码许可证和提取出来的数据许可证是两回事。WikiPron 明确要求遵循 Wiktionary 数据许可；后续补充包应保留词条来源、版本和修改说明，按数据许可发布，不能只复制工具的 Apache/MIT LICENSE。见 [WikiPron License](https://github.com/CUNY-CL/wikipron#license) 和 [Wiktionary 数据许可](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)。

## Chrome / Firefox 存储实测

基准使用真实 Chromium 153.0.8010.12、Firefox Developer Edition 158.0，后者使用独立临时 profile，不改日常浏览器。三份数据、三种布局、两个浏览器、每组五轮，共 90 轮。每轮验证 101 个查询结果与数据一致，共 9,090 次结果断言。

对比三种读取策略：

- 全量 TSV：保留当前排序文本二分查找，首次读取整个词库。
- Hash 64 分片：按词头哈希分散到 64 个文件，最多保留最近四片。
- 有序 64 分片：按排序后的词条划成约 64 个连续区间，通过小索引定位，最多保留最近四片。

二分查找直接从 `src/speech/pronunciation.ts` 转译注入浏览器；SHA256 随结果保存。资产通过本机 HTTP `no-store` 读取，不经过互联网；OS 文件缓存未清空。首次查询包含读取、解码和查找，有序分片还包含索引请求。它不是完整扩展划词 E2E，不包含消息传递、渲染和 AI 推理。

### 当前美式词库：分片减少首次读取，全文批量查询仍适合全量加载

| 布局 | Chromium 首次查询中位数 | Firefox 首次查询中位数 | 查询序列内最大缓存文本载荷 | 文件 gzip 合计 |
| --- | ---: | ---: | ---: | ---: |
| 全量 | 20.4 ms | 14 ms | 5.15 MB | 872 KB |
| Hash 分片，缓存四片 | 1.9 ms | 3 ms | 0.329 MB | 1,321 KB |
| 有序分片，缓存四片 | 2.6 ms | 7 ms | 0.365 MB，另有小索引 | 884 KB，包含索引 |

“缓存文本载荷”按字符串长度 × 2 计算，仅表示保留文本的 UTF-16 大小，不是 JS 堆、进程内存或峰值内存。它不包括字符串对象、响应缓冲、GC 尚未回收的文本和后续纯 CPU 测试的预加载数据。不能把表中的 0.365 MB 当作扩展总内存。四个最大有序片的简单上界也不应等同于本次实际观察值。

Hash 分片打散相邻词，使 gzip 比全量多约 51%；有序分片只多约 1.4%。因此对包体积敏感时，优先考虑有序分片。

代价是跨分片连续查询：首次查询后，按固定顺序连续查 101 个不同词，当前美式全量仅需 Chrome 0.4 ms / Firefox 1 ms；有序分片需 74.5 ms / 164 ms，并产生包括首次读取和索引在内约 100 次本地资产请求。数据规模较大时更不应给全文批量分析机械套用四片缓存。按次划词和整篇批量查词需要不同读取策略。

纯 CPU 热查找为预加载文本后重复查询 101 个词 100 次，测量批次均摊耗时，避免逐次亚毫秒计时失真。所有数据/布局/浏览器的中位均摊查询约 0.5–1 微秒。它不是单次查询 P95，也不是包含 IO 的划词耗时。

### 更大的候选库也能保持较低的按需读取开销

| 数据 | 全量首次查询 Chrome / Firefox | 有序分片首次查询 Chrome / Firefox | 四片缓存最大文本载荷 |
| --- | ---: | ---: | ---: |
| WikiPron UK | 16 / 12 ms | 2.6 / 4 ms | 0.261 MB |
| ECDICT 仅音标 | 30.6 / 20 ms | 2.8 / 5 ms | 0.651 MB |

这些只是读取性能，不是采用对应词库的理由。WikiPron 的重音损失和 ECDICT 的科技义项问题仍然存在。五轮样本只用于本机选型，不提供跨设备或尾延迟保证。原始结果见 [browser-storage.json](../performance/data/2026-10-07-dictionaries/browser-storage.json)。

## 推荐的下一步

1. **数据优先补科技缺口。** 保留现有基础音标，新增有来源的科技术语补充包。区分普通词、缩写和产品名；允许多个正确读法。释义与音标分别验收，不能通过填满字段来提高通过率。
2. **新增音标从保留重音和口音标签的上游提取。** Kaikki/Wiktextract 是候选构建来源，先建立抽样质量基线再决定包大小；不直接采用本轮 WikiPron TSV 替换全部音标。
3. **按使用方式控制加载。** 日常划词可采用有序分片和缓存字节上限；每个后台统一共享加载和取消隔离。大批量查词按片分组，必要时暂时预载，避免 LRU 抖动。索引失败、取消、分片缺失、多请求合并、后台重启都需要扩展级回归测试。
4. **暂不新增 SQLite/WASM 或 G2P 运行时。** 目前需求只是静态词头查找，现有二分查询已经足够快。索引与数据在构建时生成，运行时不导入几十万条 IndexedDB 记录；现有 IndexedDB 仍用于模型结果缓存。

建议的工程预算是：小型科技补充包先以 gzip ≤ 1 MB 为目标；按需查询的常驻字典文本与索引以 ≤ 1 MB 为目标；保持纯查找低于 1 ms，再用扩展级 E2E 设定可用内容出现时间。这些是待验收预算，不是本轮已实现指标，也不保证能覆盖所有科技词。

## 复现与验证

```sh
python3 tests/performance/prepare-dictionary-research.py --download
node tests/performance/benchmark-dictionary-storage.mjs
pnpm lint
pnpm typecheck
pnpm exec vitest run tests/unit/pronunciation.test.ts
```

首条命令下载固定快照并校验 SHA256；不带 `--download` 可使用已有本地文件离线复测。两条测量命令会更新本报告对应的 JSON，复跑前应保留旧文件用于比较。Firefox 默认采用已安装的 Developer Edition，可通过 `FIREFOX_BINARY` 指定兼容的 Firefox 二进制。

本轮验证：90 轮浏览器测量完成，全部查询结果断言通过；lint、typecheck 和现有 11 项音标测试通过。实验仅增加研究脚本、固定语料和报告，没有把分片原型接入生产翻译或词卡。
