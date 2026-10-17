# 网页中文段落判断的本地开销

2026-10-18。仅测文字判断，不读取译文缓存或调用模型。

本地纯文本基准使用 darwin / arm64、Node v24.14.0，每场景预热 100 次、测量 1,000 次。800 字符中文技术段落平均 0.030 ms、P95 0.035 ms；900 字符纯英文走快速路径，测量均值低于 0.001 ms。这不包含 DOM、模型推理或网络时间，不作为跨设备性能保证。

[原始结果](../../tests/performance/baselines/2026-10-18-source-language.json)；复现命令：

```sh
node --experimental-strip-types tests/performance/benchmark-source-language.mjs
```
