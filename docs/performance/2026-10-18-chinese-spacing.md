# 中文间距整理的本地开销

2026-10-18，在当前开发用 Apple Silicon Mac（darwin / arm64，Node v24.14.0）运行纯文本基准。无模型请求、无 DOM，也不读取译文缓存。每个场景预热 100 次、测量 1,000 次，记录算术平均与排序后第 95 百分位单次耗时。

| 场景 | 字符数 | 平均 | P95 |
| --- | ---: | ---: | ---: |
| 技术段落 | 800 | 0.028 ms | 0.032 ms |
| 包含中文路径的 URL 与正文 | 8,000 | 0.158 ms | 0.186 ms |
| 接近消息上限的连续反引号 | 19,992 | 0.039 ms | 0.046 ms |

[原始结果](../../tests/performance/baselines/2026-10-18-chinese-spacing.json)与[可执行脚本](../../tests/performance/benchmark-chinese-spacing.mjs)。复现：

```sh
node --experimental-strip-types tests/performance/benchmark-chinese-spacing.mjs
```

结果仅表示本机纯文本处理开销，不等于完整翻译耗时或其他设备性能保证；不设易受机器负载影响的 CI 毫秒门槛。生产实现不新增网络、模型推理、数据库写入或 DOM 扫描。流式段落和最终确认均会经过格式处理。
