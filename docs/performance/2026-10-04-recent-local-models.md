# 近期本地模型：翻译质量与运行成本

筛选范围为 2026-08-04 至 2026-10-04 发布、可以下载权重并在本机运行的模型，目标进程内存约 2–3 GiB。MLX 优先。云端专属模型不纳入，开源但远超预算的大模型也不纳入。本页不代表对这段时间所有模型的穷举。

本轮实际测试 MiniCPM5-2B 和 LFM2.5-2.6B，合计 72 次质量请求。两者在测试中均符合内存目标，但都有影响替换的质量问题，**暂不改变默认模型**。

## 候选与结论

| 候选 | 发布证据 | 本轮状态 |
| --- | --- | --- |
| MiniCPM5-2B | [OpenBMB 更新日志：2026-09-07](https://github.com/OpenBMB/MiniCPM/blob/main/README-cn.md) | 已完成两轮质量评测、6 次 TPS 与 12 次 provider 场景测试；内存达标，但不建议替换默认模型 |
| LFM2.5-2.6B | [Liquid AI：2026-08-04](https://www.liquid.ai/blog/lfm2-5-2-6b) | 官方 MLX 包完成两轮质量评测；15/18 例可接受，请求耗时中位数 4.62 秒，暂不建议替换 |
| Granite 4.2 3B | [IBM：2026-08-25](https://research.ibm.com/blog/introducing-granite-4-2) | 已发现，尚未进行本机实测；不据厂商基准推断中文翻译质量或本机内存 |

Grok 4.7 的官方发布形式是 API，本轮不考虑。GLM-5.3-Flash 有开放权重，但官方给出 320B 总参数、18B 激活参数；激活参数少不代表只需加载这些权重，不符合本轮内存预算。它被排除的原因是资源预算，而不是不能本地部署。[Grok 官方说明](https://docs.x.ai/developers/release-notes)、[GLM 官方模型卡](https://huggingface.co/zai-org/GLM-5.3-Flash)。

## MiniCPM5-2B 与已有基线

同一台 Apple M4 Pro / 48 GiB，mlx 0.32.3、mlx-lm 0.32.0、4-bit、temperature=0、并发 1、关闭 prompt cache。MiniCPM 与两个 Qwen 均关闭 thinking。旧模型数字来自同一天较早的归档，**不是本轮交错运行的同时对照**，桌面负载差异可能影响速度。

| 指标 | Qwen2.5 3B | Qwen3 1.7B | MiniCPM5 2B |
| --- | ---: | ---: | ---: |
| HTTP 生成 TPS 中位数（6 次） | 101.5 | 175.2 | 127.0 |
| 首个正文 token 延迟 | 244 ms | 153 ms | 195 ms |
| 进程 physical footprint | 2.0 GiB | 1.4 GiB | 1.6 GiB |
| 记录到的 footprint 峰值 | 2.2 GiB | 1.7 GiB | 1.9–2.0 GiB |
| 固定质量用例可接受数 | 14/18 | 17/18 | 14/18 |
| 严重错误用例 | 1 | 0 | 2 |
| 三个词条 × 两次结构通过数 | 4/6 | 0/6 | 0/6 |

“可接受”包含固定规则及 Codex 逐例审阅，**不是独立人工盲评**。每例两次请求，共 36 次；MiniCPM 同一用例两轮输出相同。规则通过不代表语义通过，词卡结构通过也不代表 IPA 或词义正确。此前 Qwen2.5 词卡有内容错误，不能把 4/6 理解为准确率。

MiniCPM 的 TPS 范围为 125.2–130.6。定义沿用 `(completion_tokens - 1) / (finish_event - first_content_delta)`，是 HTTP 估算，不是内核计时。模型 tokenizer 不同，TPS 不能直接当作相同中文字数的速度。Resident 约 2.1 GiB；权重文件为 1,416,035,216 字节，不能把文件大小等同进程内存。内存仅覆盖短上下文测试，不能外推到 128K 上下文。

### 为什么暂不切换

MiniCPM 比旧默认的纯生成 TPS 高约 25%，但在真实 provider 的双段长文上耗时 **2471 ms**，旧默认为 **1590 ms**、Qwen3 为 **959 ms**。MiniCPM 两轮都触发批量 JSON 失败后的逐段回退，总计 3 个请求。首个完整段落约 743 ms 推送，整批无需等全部完成，但回退增加了总耗时。

其余 provider 场景为日常双段 607 ms、技术双段 716 ms。三个词卡都失败：cloudy/light 两次结构校验仍不合格，bank 达到输出长度上限；这是当前提示词、1024-token 词卡预算和校验管线下的结果，不等于该模型经过适配后永远不能生成词卡。

质量上的主要问题：

- **T03 数字所指改变**：`over five years` 原指五年期间，译为“比较五个街区”，丢失持续时间并改变社区数量。
- **T05 日期损坏**：`12 October 2026` 译为“12月2026日”，无法作为截止日期使用。现有硬性规则检查到了年份存在，却没有检出年月日关系错误，逐例审阅将它判为严重错误。
- **T02 主体错译**：reader 被译为“读取器”，不是读者。
- **T18 语境错译**：connection 被译为“连接”，不是交通转乘。

T04 单块两段没有漏掉后半篇，但“五个年度的几个社区”对五年间研究的表达不清。该表述按旧 Qwen2.5 同类输出的尺度记为轻微偏差，不能声称模型凭空增加了五年。

相对 Qwen2.5 3B，MiniCPM 在 T03、T05 回退，改善了 T06、T11；总通过数相同不代表可以无损替换。**保持当前默认配置不变**。Qwen3 1.7B 仍是这批已测模型中全文翻译较好的候选，但当前词卡适配不过关，不能直接作为四项功能通用默认。

## LFM2.5-2.6B 的兼容性与测试口径

先尝试的社区包 `mlx-community/LFM2.5-2.6B-4bit`（revision `72a08228cf703cd7dc0187abf4edbbd8e935f864`）加载失败：600 个权重名称带有当前 mlx-lm 0.32.0 未处理的 `language_model.` 前缀，生成线程退出，预热返回 HTTP 404。这是该包与当前运行时的兼容问题，不计为翻译质量失败，也不能据此称该模型不能本地部署。

随后改用官方 `LiquidAI/LFM2.5-2.6B-MLX-4bit`，revision `04efa23776ce61ec34ec95ec34c859854c89542b`，成功加载并生成译文。配置为主体 4-bit、词嵌入 6-bit，权重 1,583,152,892 字节。官方模板始终添加未闭合的 `<think>`，因此使用 `QUALITY_THINKING=enabled`，没有强行修改模板跳过思考。[官方量化包说明](https://huggingface.co/LiquidAI/LFM2.5-2.6B-MLX)、[模型思考行为](https://huggingface.co/LiquidAI/LFM2.5-2.6B)。

原始语料、provider、温度 0、并发 1 和输出预算均沿用其他模型，思考模式明确不同。测试的是能否直接适配当前插件，而非厂商推荐采样条件下的最佳效果。LFM 官方推荐温度 0.1、top_k=50、repetition_penalty=1.1，本轮没有另行为该模型调参。

本轮只对 LFM 做真实 provider 质量与请求耗时测试，**未给出其 TPS 或词卡通过率**。服务器的 completion_tokens 包含思考 token，而已有无思考 TPS 公式从首个正文 token 起算，直接套用会夸大结果。质量阶段的 vmmap 单次采样显示 footprint 约 1.9 GiB、截至采样时峰值约 2.1 GiB；不是全程峰值或长上下文保证，也与 MiniCPM 测后采样时点不同。

36 次请求中自动检查通过 34 次，结合署名审阅后 15/18 例可接受。同一用例两轮输出一致。请求耗时中位数 **4617 ms**，范围 2064–13840 ms；可观察到首个完整译文块的请求，其中位数为 **4477 ms**，不是首 token 延迟。相同质量语料下 MiniCPM 为 408 ms、旧 Qwen3 1.7B 为 554 ms 的完整请求中位数。该比较包含模型原生思考成本，不能归因成解码 TPS 差异；桌面负载及单次内存采样也可能扰动时延。

三项未达标用例：T04 单块长文两轮均触发输出长度上限，无有效译文；T13 把叙事中的“第二天上午”改成相对说话日期的“明天早上”；T18 仍把交通 connection 译为“连接”。前两项记为严重错误。它修正了 MiniCPM 的日期和五年研究问题，但没有达到旧 Qwen3 17/18 的质量结果，而且等待更久。没有通过增加输出预算或修改提示词来掩盖直接替换时的问题。

两个新候选都未通过全部用例门槛，也未通过相对旧默认模型的无退步门槛。LFM 相对旧默认的退步为 T04、T13；MiniCPM 为 T03、T05。门槛退出码与逐项回退均保存在 [gate-results.json](../../tests/quality/baselines/2026-10-04-recent/gate-results.json)。

## 固定用例、数据与复现

- [逐例原文、参考译文、四个模型实际输出与审阅](2026-10-04-recent-quality-cases.md)
- [质量基线与语料快照](../../tests/quality/baselines/2026-10-04-recent/)
- [MiniCPM 性能原始数据](data/2026-10-04-recent/minicpm5-2b/)，包括每条 SSE 与计时、provider 输出、vmmap 摘要。
- [LFM 官方包信息与质量阶段内存采样](data/2026-10-04-recent/lfm25-26b/)，质量结果在上述 `tests/` 基线目录。
- [既有 Qwen 性能基线](2026-10-04-mlx-models.md)、[质量门槛定义](../development/translation-quality.md)

MiniCPM 测试仓库为 `openbmb/MiniCPM5-2B-MLX`，revision 固定为 `8a9ad7539ac86281d0ac2b017ba04a5de53fe9a3`。官方推荐采样温度为 1；本轮采用项目统一的温度 0，衡量当前插件配置下的替换效果，没有宣称取得厂商最佳质量。

下载完成后运行，输出目录必须是新目录：

```sh
MLX_PYTHON=/path/to/mlx-env/bin/python \
QUALITY_MODELS=openbmb/MiniCPM5-2B-MLX \
QUALITY_OUTPUT=artifacts/quality/minicpm-new-run \
pnpm test:quality:mlx

MLX_PYTHON=/path/to/mlx-env/bin/python \
BENCH_MODELS=openbmb/MiniCPM5-2B-MLX \
BENCH_OUTPUT=artifacts/benchmark/minicpm-new-run \
pnpm dlx tsx@4.23.15 tests/performance/benchmark-mlx-models.ts

MLX_PYTHON=/path/to/mlx-env/bin/python \
QUALITY_MODELS=LiquidAI/LFM2.5-2.6B-MLX-4bit \
QUALITY_THINKING=enabled \
QUALITY_OUTPUT=artifacts/quality/lfm-new-run \
pnpm test:quality:mlx
```

质量语料版本为 1.0.1，provider 与旧基线哈希相同。所有请求只使用仓库固定合成文本。测试服务使用独立端口并在结束后停止，没有更改日常 8080 服务或浏览器配置。
