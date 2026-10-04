# 离线 US / UK 音标

词卡的语境释义和例句由模型生成，音标由本地词典提供。US 使用 [ipa-dict 的 General American 数据](https://github.com/open-dict-data/ipa-dict)，UK 使用 [Britfone 的 RP / Standard Southern British 数据](https://github.com/JoseLlarena/Britfone)。具体版本、源文件与生成资产 SHA256、完整许可证均保存在 [public/dictionaries](../../public/dictionaries/)。

数据覆盖约 12.6 万个美式词条和 1.5 万个英式词条。两个 TSV 合计约 3.54 MB，gzip 合计约 978 KB。扩展安装包包含数据；只有首次划词才由 background 加载，不联网查词，不随内容脚本注入网页。运行中保留排序文本并二分查找，不额外创建十几万个 Map 项；多个请求共享加载，取消只结束当前等待。失败后允许下次重试。

US / UK 分别返回结果，缺失一方不复制另一方。多读音同时显示，不声称已根据上下文选定。整短语没有精确词条时留空，不把拼接单词音标伪装成词典核验过的短语发音。系统语音按钮仍可发音。

两份词典的转写习惯不同：例如 Britfone 使用 /ɐ/ 而非常见传统 /ʌ/。保留上游数据，不做无依据替换。离线来源减少 LLM 编造音标，但不保证上游没有错误或覆盖所有词。

重建：

```sh
python3 scripts/build-pronunciation.py
python3 scripts/build-pronunciation.py --offline
```

构建脚本校验固定源文件的 SHA256，下载缓存位于忽略提交的 `artifacts/pronunciation-sources`。扩展正常使用不执行构建或下载。代码入口为 `OfflinePronunciationDictionary`，通过 loader 注入读文件方式；真实质量测试从同一份打包资产读取，不能用测试专属正确答案替代。
