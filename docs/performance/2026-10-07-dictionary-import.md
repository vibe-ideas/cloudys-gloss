# 0.1.2：离线词库导入与真实浏览器验证

2026-10-07，Apple M4 Pro。新增 StarDict 导入、进度、取消、查询验证、启停、删除及词卡本地释义展示。使用方法见 [词库导入指南](../guides/dictionary-import.md)。本轮没有替换默认音标库，也没有把导入词义自动注入 AI 提示词。

## 实测结果

真实数据沿用 [GoldenDict 调研](../research/2026-10-07-goldendict.md)下载的 FreeDict eng-zho 2025.11.23 StarDict 包。测试先校验官方 SHA512，再直接从已校验压缩包中读出文件，防止测试到另一份松散文件。

| 指标 | Chromium | Firefox Developer Edition |
| --- | ---: | ---: |
| 成功导入的原始记录数 | 26,660 | 26,660 |
| 导入观察耗时，单次 | 3,316 ms | 2,164 ms |
| 查询次数 | 303 | 303 |
| 每轮 101 个科技词的词头命中 | 34 | 34 |
| 查询中位数 | 0.4 ms | 0 ms（计时量化） |
| 查询 P95 | 0.7 ms | 1 ms |
| 最大观察查询耗时 | 1.9 ms | 3 ms |

导入计时包括测试文件注入、IndexedDB 暂存、后台解压解析、索引写入和观察状态；Firefox 还包含测试桥的 Base64 注入，不是两个存储引擎的纯性能对比。每浏览器最终归档一轮导入，不能推断导入 P95。先前功能验证轮未混入表中。

导入后重新打开设置页，验证 `algorithm` 的中文释义，再依次查询固定的 101 个科技词，共三轮。查询计时在真实扩展设置页进行，包含 runtime messaging 与后台 IndexedDB 索引查询，不含词卡渲染、模型生成和建库。命中与未命中一起统计，未清空浏览器缓存。Firefox 的 0 ms 是 `performance.now()` 分辨率造成的量化，**不代表没有成本**。

原始记录：[Chromium](data/2026-10-07-dictionary-import/chromium.json)、[Firefox](data/2026-10-07-dictionary-import/firefox.json)。不是 GoldenDict 桌面程序跑分，也没有测量进程 RSS、堆或峰值内存。

## 存储与资源边界

- 大文件通过扩展同源 IndexedDB 暂存，消息仅传入导入 ID。网页 content script 不接触原始词库文件。
- 每 500 条写入一批，批次之间让出执行机会；查询不经过模型队列。导入阶段暂时保留解压文件，不能把 64 MiB 正文上限宣传为峰值内存。
- 临时词库不参与查询。正文与别名全部校验通过后，在同一个事务中启用词库并删除暂存。取消、格式错误与重启后的半成品都会清理。
- 正文和别名使用独立记录，别名引用原文序号，不复制正文。对 `.idx` 重复偏移额外限制累计引用正文量，防止小源文件膨胀成巨量数据库。
- 以 `[词库 ID, 规范化词头, 原始词头, 序号]` 为查询键，优先原始大小写匹配。日常查词只读取少量记录，无全库扫描、全量内存 Map 或新增模型请求。
- HTML / Pango / XDXF 转成文本，所有输出经 Preact 文本节点渲染。词库内脚本、远程图片、外链和音视频不运行；实体解码使用 `entities`，仅在设置页与后台打包。

当前读取上限：每库最多三个匹配结果，所有库合计最多六条；正文展示每条不超过 12,000 字符，长词条提示截取。最多五个词库；格式与文件预算详见使用指南。

## 验证范围

- `pnpm check`：lint、typecheck、356 项单元测试通过。
- Chromium / Firefox 构建通过；26 项双浏览器 E2E 通过，覆盖导入与原有翻译、选词、音标、设置和悬浮球。
- 两项真实 FreeDict 导入与查询测试通过；独立临时 profile，不改用户日常词库和模型设置。
- 单元回归覆盖：压缩与别名、重建查询服务后的持久化、大小写义项、启停与删除、取消回滚、重启清理、错误记录数、非法偏移、无效别名、解压预算、重复正文放大、格式拒绝、HTML 安全展示、AI 失败后保留本地释义、迟到结果不串词。
- 修复测试初始化时序：Firefox `document_idle` 内容脚本可能晚于 load 事件，测试会先等待悬浮控件出现，再发送页面翻译指令。没有通过重试切换操作掩盖问题。

已检查实际截图：[设置页](../design/images/dictionary-import-settings.png)、[Firefox 本地释义卡片](../design/images/imported-dictionary-card.png)。图中使用合成词条和本机测试模型地址。没有看到卡片越界或文字重叠；本轮没有承诺覆盖所有第三方词库排版。

## 复现

```sh
pnpm check
pnpm build
pnpm build:firefox
pnpm exec playwright test tests/e2e/dictionary-import.spec.ts tests/e2e/dictionary-preview.spec.ts tests/e2e/extension.spec.ts --reporter=list

# 下载校验过的公开词库；与用户自有词库无关
python3 tests/performance/prepare-goldendict-research.py --download
pnpm exec playwright test -c playwright.dictionary.config.ts --reporter=list
```

真实词库测试在 `tests/live/dictionary-import.spec.ts`，默认 CI 不下载第三方数据。归档数据取自各测试的 `real-dictionary-performance.json`；后续复测应保留历史结果。

尚未支持：MDX / DSL、64 位大词库、直接导入外层 ZIP/TAR、词库音视频、全文或模糊检索。当前版本提供 StarDict 文本词库的完整导入管理与查询流程。
