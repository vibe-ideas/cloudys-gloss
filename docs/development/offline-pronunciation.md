# 离线 US / UK 音标

词卡的语境释义和例句由模型生成，音标由本地词典提供。US 使用 [ipa-dict 的 General American 数据](https://github.com/open-dict-data/ipa-dict)，UK 使用 [Britfone 的 RP / Standard Southern British 数据](https://github.com/JoseLlarena/Britfone)。具体版本、源文件与生成资产 SHA256、完整许可证均保存在 [public/dictionaries](../../public/dictionaries/)。

基础数据覆盖约 12.6 万个美式词条和 1.5 万个英式词条。两个原始 TSV 合计约 3.54 MB，gzip 合计约 978 KB。自 0.1.1 起，构建时将每个口音划成约 64 个有序区间，安装包只包含分片，不重复包含整库。划词由 background 按需读取，不联网查词，不随内容脚本注入网页。

运行中保留排序文本并二分查找，不额外创建十几万个 Map 项；分片缓存按 UTF-16 文本载荷限制为 768 KiB，超限淘汰最近最少使用的片，资产读取最多并行两个。该预算不等于进程总内存：索引、小型补充库、临时响应缓冲和 JS 对象不在其中。多个请求共享加载，取消只结束当前等待；读取失败允许下次重试。

0.1.1 还加入 47 个补缺词条，来自 Wiktionary / Kaikki 的逐词原始 JSONL，运行时文件 `technology.json` 仅 3,748 字节。仅填充基础词典缺失的口音，保留重音和全部选入变体；未标注口音的 IPA 单独显示“词典未标注口音”，不会复制到 US / UK。来源、口音标签、原始文件哈希和排除原因保存在 `technology-sources.json`，补充数据使用 CC-BY-SA-4.0，许可随包分发。

US / UK 分别返回结果，缺失一方不复制另一方。多读音同时显示，不声称已根据上下文选定。整短语没有精确词条时留空，不把拼接单词音标伪装成词典核验过的短语发音。系统语音按钮仍可发音。

两份词典的转写习惯不同：例如 Britfone 使用 /ɐ/ 而非常见传统 /ʌ/。保留上游数据，不做无依据替换。离线来源减少 LLM 编造音标，但不保证上游没有错误或覆盖所有词。

重建：

```sh
python3 scripts/build-pronunciation.py
python3 scripts/build-pronunciation.py --offline
python3 scripts/build-tech-pronunciation.py
pnpm build:firefox
```

基础库构建脚本校验固定源文件的 SHA256，下载缓存位于忽略提交的 `artifacts/pronunciation-sources`。科技补充库从 `data/pronunciation/technology-sources.json` 归档的来源摘录离线重建。新增或修改来源时须重新审阅口音标签、重音、是否完整转写及备注，不能把音频的口音标签套到另一条 IPA 上。

扩展正常使用不执行构建或下载。生产入口是 `PackagedPronunciationDictionary`；WXT 的 `build:publicAssets` 调用 `scripts/dictionary-assets.ts` 生成分片。`OfflinePronunciationDictionary` 保留为整库基线读法。真实模型质量测试改为使用同一生产读取器和分片，不使用测试专属正确答案。覆盖与验证见 [0.1.1 升级记录](../performance/2026-10-07-dictionary-upgrade.md)。
