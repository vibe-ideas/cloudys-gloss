# GoldenDict 生态是否适合科技阅读插件

2026-10-07，Apple M4 Pro。结论：**值得借鉴离线词库导入与索引方式，但本轮没有找到可以直接替换现有科技词卡的通用词库。** 默认仍采用现有音标库、已审核科技补充包和模型语境解释；用户自带词库可以作为后续独立能力。

本轮实际做了 GoldenDict-ng 官方文档与源码检查、FreeDict StarDict 文件解析、FOLDOC 原文解析，以及 Chromium / Firefox 的 60 轮读取测试。**没有安装或运行 GoldenDict 桌面程序；没有测量其启动、建索引耗时或进程内存。** 下文浏览器数据是本项目的读取原型，不是 GoldenDict 跑分，也不是完整词卡 E2E。生产插件、本地安装版本和模型配置均未改动。

## 应用、格式和内容是三层

GoldenDict / GoldenDict-ng 是词典阅读与检索程序；StarDict、MDict、DSL 是文件格式；FreeDict、FOLDOC 或用户购买的具体词典才决定能查到什么。支持一种格式，并不保证拿到了优秀的英汉科技词库。

本轮检查 GoldenDict-ng 稳定版 **v26.8.0**，源码固定到 [`c84e0113b84fc9ee6d5cfef8de646b0eb95d7707`](https://github.com/xiaoyifang/goldendict-ng/tree/c84e0113b84fc9ee6d5cfef8de646b0eb95d7707)。官方 macOS ARM64 安装包根据 Qt 版本分别为 217,307,353 / 229,078,132 字节。这是下载体积，不能换算为运行内存，也不含用户词库。[发布页](https://github.com/xiaoyifang/goldendict-ng/releases/tag/v26.8.0)，[本轮元数据](../performance/data/2026-10-07-goldendict/engine-sources.json)。

从官方架构和 StarDict 实现中，可以借鉴以下做法：

- 持久化 B-tree 词头索引，索引记录正文位置；命中后按 offset / size 读取文章，避免每次加载全部释义。
- 按词库格式分开解析器，查询通过异步请求返回，支持取消；词库变动或索引版本过期时重建。
- 词头查找与全文检索分开。Xapian 用于后者，全文索引可能耗时、占用较多磁盘；划词查询无需为此引入完整全文搜索引擎。

依据：[架构说明](https://xiaoyifang.github.io/goldendict-ng/architecture/)、[固定版本 StarDict 实现](https://github.com/xiaoyifang/goldendict-ng/blob/c84e0113b84fc9ee6d5cfef8de646b0eb95d7707/src/dict/stardict.cc)、[全文索引说明](https://xiaoyifang.github.io/goldendict-ng/ui_fulltextsearch/)。

它公开的 CLI / `goldendict://` 接口主要用于打开主窗口或查词浮窗。`gdlookup://localhost` 是 Qt WebEngine 内部 scheme，不是可直接 fetch 的 localhost HTTP 服务。在本轮查阅的官方接口中，没有发现用于返回结构化词卡的通用 HTTP API；“外部程序作为词典”则是 GoldenDict 调用程序输出，方向相反。[CLI](https://xiaoyifang.github.io/goldendict-ng/cli/)、[Sources](https://xiaoyifang.github.io/goldendict-ng/manage_sources/)。

因此，直接调用桌面应用适合“在 GoldenDict 中打开”这类可选动作；如果要把释义显示在当前网页的 Shadow DOM 词卡，导入数据更符合现有交互。

## 两份词库的实际覆盖

沿用 [101 个科技词、产品名、缩写与短语](../../tests/performance/dictionary-tech-corpus.json)，大小写归一后精确匹配。FOLDOC 的纯转引会递归解析，并保留目标词头；不存在的转引目标不会编造正文。这里不是随机词频加权语料，**命中不代表意思正确**。

| 数据 | 本次处理后的词头 | 基础技术词 / 39 | 新技术与产品 / 33 | 缩写 / 19 | 短语 / 10 | 总命中 / 101 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FreeDict eng-zho 2025.11.23 | 24,786 | 26 | 6 | 1 | 1 | 34 |
| FOLDOC 本次下载快照 | 15,034 | 31 | 3 | 15 | 4 | 53 |
| 当前 US 音标库，仅作覆盖参照 | 125,927 | 35 | 9 | 7 | 0 | 51 |

FreeDict 原包有 26,660 条记录，合并重复词头及大小写后为 24,786。FOLDOC 下载文本解析出 15,282 个标题，包含说明等非普通词条，合并大小写后为 15,034；不把网站首页展示的数量当成本次解析值。当前 US 库提供音标，另外两份主要提供释义，三者不能按命中数评选“整体最好”。升级版 US + UK + 科技补充包在同一诊断集上的任意音标命中为 60/101，详见 [0.1.1 报告](../performance/2026-10-07-dictionary-upgrade.md)。

### FreeDict：一般英汉释义有用，但不适合直接作为科技默认答案

通过 [FreeDict 官方下载](https://freedict.org/downloads/) 取得 StarDict 文件，SHA512 与官方 API 一致。原包 1,672,048 字节；解压后正文 8,124,281 字节、词头索引 464,739 字节。没有下载来源不明的商业词典合集。

- `software`、`algorithm`、`database`、`network` 有可用的一般科技解释。
- `latency`、`throughput`、`GPU`、`LLM`、`Kubernetes`、`TypeScript` 等未命中。
- `transformer` 是电气工程里的变压器；大小写归一后的 `RAG` 命中普通名词 `rag` 的碎布等义项。不能当作模型架构或检索增强生成的解释。
- 词条中虽然有读音，但可见多种变体、部分片段式读音，缺少可直接映射到独立 US / UK 字段的标签。不能仅凭顺序给读音分口音。

原包 `.ifo` 声明数据来自 Wiktionary，经 DBnary / WikDict 生成，许可为 **CC BY-SA 3.0**。这是具体词库的许可，独立于 GoldenDict-ng 的 GPLv3+ 代码许可；本轮只生成研究副本，没有加入扩展资产。

### FOLDOC：传统计算机术语较强，当代 AI 与产品词不足

[FOLDOC 官方来源](https://foldoc.org/source.html)提供纯文本，不是直接下载到的 StarDict 包；如需导入 GoldenDict，应先转换为它支持的格式。此次原文为 5,451,795 字节，按 SHA256 固定快照。没有使用另一个旧的 `Dictionary.gz` 文件冒充当前原文。

- API、CPU、SQL、JSON、并发、垃圾回收、竞态条件等能得到计算机相关解释。
- `GPU` 有词头，但只有指向 `Graphics Processing Unit` 的转引，目标在该快照中不存在；本轮只计词头命中，不计有效释义通过。
- `embedding` 是数学与域理论解释；未收录 Transformer 模型架构、LLM、RAG、Kubernetes、TypeScript、Docker 等本轮关注的义项或词头。
- 内容以英文为主，不提供完整中文词卡，也没有统一的双口音 IPA 字段。部分知识表述较旧，例如并发转到单处理器多任务解释，不能当成现代主题的完整说明。

数据文件声明 **GFDL 1.1 或更新版本**，无不变章节及封面文本。若后续提取并发布，需要随数据维护来源、许可和修改说明。[FOLDOC 许可说明](https://foldoc.org/GNU%2BFree%2BDocumentation%2BLicense)。

### 固定的科技义项诊断用例

新增 [20 个带语境的检查项](../../tests/quality/offline-dictionary-cases.json)：四个基础概念作为正向对照，另有缩写、产品名和容易串义的科技词。脚本检查词条中是否包含各组必要概念，区分未收录、仅有无效转引、缺少必要概念。

FreeDict 通过 **4/20**；FOLDOC 通过 **12/20**。这是诊断集的概念字符串检查，**不是人工准确率、通用质量分或独立盲测**。检查项在本轮调研中建立，其中正向对照是检查数据后补充的；以后修改规则需同步更新结果。它能稳定暴露本轮缺口，不能证明完整解释或例句质量，也不能证明命中的全部义项都适合当前语境。

逐词命中、检查结果、输入和来源哈希见 [coverage.json](../performance/data/2026-10-07-goldendict/coverage.json)。完整正文只留在忽略的 `artifacts/`，报告不复制整个词库。

## 浏览器读取性能

为判断“导入词库是否一定很重”，把释义简化为纯文本，再统一生成有序 JSONL。比较全量读取与约 64 个连续分片、768 KiB 文本 LRU；两个策略使用相同的 JSONL 二分查询。没有使用桌面引擎或现有生产 IPA 读取器。

| 数据 | 规范化文本 | 全量 gzip | 分片 gzip 合计，含索引 |
| --- | ---: | ---: | ---: |
| 当前 US 音标，统一研究格式 | 3.94 MB | 0.89 MB | 0.91 MB |
| FreeDict，去 HTML 保留文本 | 4.91 MB | 1.91 MB | 1.99 MB |
| FOLDOC，展开转引 | 7.71 MB | 2.68 MB | 2.77 MB |

十进制 MB。FOLDOC 因复制转引目标而比原文大；正式导入应保留词条 ID 与转引关系，避免重复正文。这里的 HTML 转纯文本只是研究用解析，**不是可上线的 HTML 清洗器**。

Chromium 153.0.8010.12、Firefox Developer Edition 158.0，各数据 / 策略五轮新 browser context，轮换策略先后，共 60 轮。首次查询依次选择 latency、algorithm、JSON、Kubernetes、inference，包含命中和未命中。下面是五轮中位数：

| 数据 | Chromium 全量 → 分片首次查询 | Firefox 全量 → 分片首次查询 | 分片序列中的最大保留文本载荷 |
| --- | ---: | ---: | ---: |
| 当前 US 音标，统一研究格式 | 23.4 → 2.7 ms | 19 → 6 ms | 0.779 MB |
| FreeDict | 24.5 → 2.7 ms | 16 → 6 ms | 0.741 MB |
| FOLDOC | 25.4 → 2.5 ms | 14 → 4 ms | 0.783 MB |

索引序列化文本另为约 4.9–5.6 KB。表中内存指标按字符串长度 × 2 计算，**不是 JS 堆、峰值或进程 RSS**，不包括临时响应、解析对象、垃圾回收滞留与索引对象。首次查询包括 loopback HTTP 读取、解码和查找，分片还包括索引读取；HTTP `no-store`，没有清理 OS 文件缓存，也不包括扩展消息与 UI 渲染。

加载后重复查询同一个 `algorithm`，分片平均每次约 Chromium 1.8–2.5 µs / Firefox 2–5 µs。这是 1,000 次批量均摊的热查询，不是单次 P95 或随机访问速度。

分片的代价是跨片 IO：固定顺序连续查 101 个不同词，FreeDict 约 82.1 / 165 ms、FOLDOC 约 67.8 / 140 ms（Chromium / Firefox）；全量加载后的同序列约 1–2.1 ms。包括首次查询与热词预热在内，分片中位约 97 / 101 次资产请求。适合偶尔划词，全文批量词典处理应按片合并请求。

60 轮的全部首次结果和 101 个查询结果与完整数据副本一致，共 6,120 次结果比较；分片缓存预算断言通过。[逐轮数据](../performance/data/2026-10-07-goldendict/browser-storage.json)。

## 适合本项目的落地选择

| 路线 | 判断 |
| --- | --- |
| 把 GoldenDict-ng 作为必需后台 | 不采用。会增加桌面安装、运行和跨平台桥接，公开接口也不直接满足词卡结构。下载包体积已知，运行内存未测，不能声称固定占用多少 MB。 |
| 支持用户导入自己的词库 | 值得做可选能力。优先 StarDict，再评估 MDX / DSL；先在导入阶段转换到统一格式，运行时保持按需查询。 |
| 打包完整 FreeDict / FOLDOC 替换当前方案 | 不采用。速度可接受，但现代科技缺口、口音字段和语境义项问题没有解决。 |
| 审核后提取科技术语补充 | 优先。来源和许可单独维护；基础定义可先展示，模型补语境含义和例句，不能让错误词典义项压过上下文。 |

格式能力以 [GoldenDict-ng 官方列表](https://xiaoyifang.github.io/goldendict-ng/dictformats/)为准；批量转换可评估 [PyGlossary](https://github.com/ilius/pyglossary)。本轮未执行 MDX / DSL 转换，未验证大型商业词库的导入性能或内容质量。

正式导入应保留原始大小写、词性、义项、口音标签、出处和转引，而不只建立 `lowercase → string`。小写索引可用于候选召回，但必须区分 `rag` 与 `RAG`、普通词与产品名。仅允许词条中的受控文本/资源进入词卡，不能直接渲染任意词库脚本。大词库导入需要取消、进度和失败后恢复；这些属于后续功能验收，不是本次已经实现的能力。

## 复现

```sh
python3 tests/performance/prepare-goldendict-research.py --download
node tests/performance/benchmark-goldendict-storage.mjs
pnpm check
```

不带 `--download` 时使用已有研究缓存。FreeDict 固定版本、FOLDOC 固定内容哈希；FOLDOC 官方 URL 会变化，下载内容不同会主动失败，必须重新审核后更新快照，不会静默替换基线。`FIREFOX_BINARY` 可指定浏览器；使用独立临时 profile，不读取日常 Firefox 配置。

本轮 lint、typecheck、现有 340 项单测通过；两浏览器读取测试通过。研究只增加脚本、诊断用例、数据与文档，没有新增运行依赖或修改扩展生产行为。
