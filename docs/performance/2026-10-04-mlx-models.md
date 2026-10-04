# M4 Pro：MLX 模型 TPS 与内存对比

日期：2026-10-04。当前默认 Qwen2.5 3B 4-bit 的 HTTP 流生成速度约 **102 tokens/s**。Qwen3 1.7B 4-bit 关闭思考后约 **175 tokens/s**，快约 73%，进程 footprint 约 **1.4 GiB**。它值得作为全文翻译候选，但当前词卡兼容性测试失败，尚不能替换默认模型承担全部功能。

## 设备与测试条件

- Apple M4 Pro，48 GiB 统一内存；MLX 0.32.3、MLX-LM 0.32.0。
- 所有模型使用 MLX 4-bit，温度 0、并发 1、关闭服务端 prompt cache；Qwen3 显式 `enable_thinking=false`。此处温度 0 是为了与插件当前配置保持一致，并非 Qwen3 模型卡推荐的质量采样配置。
- 顺序：3B → 1.5B → 1.7B，然后反向；每块预热一次、不计入样本，再测 3 次 TPS。每模型 6 次 TPS 样本；每种插件场景另测 2 次。
- 模型均预先下载完毕，使用全新服务进程；完整比较不包含先前下载尚未完成而超时的探索轮次。
- 常规应用和闲置的 8080 MLX 服务仍在后台。测试服务使用 18081，每次只运行一个候选；内存表仅计测试服务进程，不是整机合计。测试期间未运行构建或测试套件，也未测并发页面推理。

模型 revision、量化组大小和权重字节数见 [model-sources.json](data/2026-10-04-mlx-models/model-sources.json)。3B / 1.5B 的 group size 为 64，Qwen3 为 128；这属于不同模型配置的实际对比，不是受控的单一变量实验。

## TPS、首 token 与内存

| 模型 | 生成 TPS 中位数（范围） | 含首 token 等待的整体 TPS | 首 token 中位数 | footprint / 历史峰值 | 总 resident |
| --- | ---: | ---: | ---: | ---: | ---: |
| Qwen2.5 3B 4-bit，当前默认 | **101.5**（100.0–102.6） | 84.8 | 244 ms | 2.0 / 2.2 GiB | 2.4 GiB |
| Qwen2.5 1.5B 4-bit | **168.9**（164.7–175.8） | 124.8 | 126 ms | 1.2 / 1.4 GiB | 1.6 GiB |
| Qwen3 1.7B 4-bit，关闭思考 | **175.2**（174.6–175.9） | 146.0 | 153 ms | 1.4 / 1.7 GiB | 1.8 GiB |

生成 TPS 的可复核口径：`(usage.completion_tokens - 1) / (收到 finish 事件的时间 - 收到首个非空正文片段的时间)`。它是 HTTP 流的解码阶段近似值，包含服务和传输开销；一个片段可能包含多个 token，因此不是精确的内核计时。整体 TPS 则为 completion tokens / 完整请求秒数。首 token 延迟包含提示词处理。token 不等于汉字。

TPS 输入是同一篇两段英文文章的纯文本翻译请求。3B 输出 121 tokens、1.5B 输出 57、Qwen3 输出 129；**1.5B 漏译了整个第二段**。因此不能把它更短的完整请求时间当成完成同等翻译工作的加速，且不同输出长度也会影响 TPS 可比性。

内存来自每块结束后的 `vmmap -summary`；peak 是工具报告的进程历史峰值，未自行连续采样。总 resident 包含映射和共享页，不等于独占物理内存。这是短上下文、单并发结果；长上下文和缓存增长可能提高开销，不能保证任何使用方式都低于 3 GiB。

## 插件真实请求耗时

调用当前 `OpenAICompatibleProvider`，沿用真实 prompt、Zod 校验和回退逻辑。时间包含回退，不包含页面 DOM、后台队列和 IndexedDB；单位为毫秒，每格为两次中位数。

| 场景 | 当前 3B | 1.5B | Qwen3 1.7B |
| --- | ---: | ---: | ---: |
| 日常阅读，两段完整 | 682 | 858 | **462** |
| 技术说明，两段完整 | 1971 | 509 | **548** |
| 较长文章，两段完整 | 1590 | 882 | **959** |
| 较长文章，首段推送 | 968 | 507 | **586** |
| 翻译结构成功 | 6/6 | 6/6 | 6/6 |
| 词卡结构成功 | 4/6 | 0/6 | 0/6 |

3B 的技术说明每次触发 3 个请求；1.5B 的日常阅读也每次触发 3 个请求；Qwen3 的三组翻译都只发 1 个请求。Qwen3 技术说明耗时减少约 72%，其中一部分来自避免回退，不能完全归功于 TPS。

词卡只覆盖 `cloudy`、河岸含义的 `bank`、重量轻含义的 `light`，各重复两次。Qwen3 和 1.5B 在现有 prompt 下均未通过重试后的结构校验；Qwen3 `bank` 失败还耗时约 7.4 秒。当前 3B 也并不可靠：`light` 两次失败，`cloudy` 虽通过结构校验，却把词性写成 noun、留下占位式上下文含义，IPA 为空。没有任何一个模型在本轮证明了完整词卡功能的可靠性。

## 选择建议

在本轮已测候选中，**Qwen3 1.7B 关闭思考适合继续做全文翻译试用**：解码快约 73%，本例长文完整耗时降低约 40%，并在 2–3 GiB 预算内留有余量。人工检查本次长文未见 1.5B 那样的整段漏译，但这不是广泛翻译质量评测。

需要同时使用全文翻译与 AI 词卡时，暂时保留默认 3B；这不表示其词卡质量合格。下一步应改善词卡结构约束或接入本地词典，并扩大质量样本，再决定是否切换。当前扩展只有一套模型配置，尚不支持“翻译用小模型、词卡用另一模型”分别配置。

1.5B 虽快，但本次漏译和词卡失败使其不适合作为默认替代。这里只比较三款实际下载的模型，不能称 Qwen3 1.7B 为所有 2–3 GiB 模型中最快。

## 试用与复现

官方 Qwen3 模型支持通过 chat template 的 `enable_thinking=False` 关闭思考；见 [Qwen 官方模型卡](https://huggingface.co/Qwen/Qwen3-1.7B-MLX-4bit)。1.5B 的 MLX 权重与使用方法见 [MLX Community 模型卡](https://huggingface.co/mlx-community/Qwen2.5-1.5B-Instruct-4bit)。

可以另开端口试用，避免与默认服务抢占 8080：

```sh
uv run --python 3.12 --with mlx-lm==0.32.0 mlx_lm.server \
  --model Qwen/Qwen3-1.7B-MLX-4bit \
  --host 127.0.0.1 --port 8081 --max-tokens 4096 \
  --decode-concurrency 1 --prompt-concurrency 1 \
  --chat-template-args '{"enable_thinking":false}'
```

扩展填写 `http://127.0.0.1:8081/v1`、模型 `Qwen/Qwen3-1.7B-MLX-4bit`，温度 0、并发 1。本轮只下载和测量，没有修改用户正在使用的默认服务或扩展配置。若同时运行两套服务，整机总内存会叠加；上表不是两套服务的总开销。

复现完整比较前，请把三款模型下载至 Hugging Face 缓存；脚本的预热请求超时为 60 秒，不包含长时间下载预算。指定 `MLX_PYTHON` 为已安装 mlx-lm 的 Python，结果目录必须为空：

```sh
MLX_PYTHON=/path/to/mlx-env/bin/python \
BENCH_OUTPUT=artifacts/benchmark/my-mlx-run \
pnpm dlx tsx@4.23.15 scripts/benchmark-mlx-models.ts

python3 scripts/summarize-mlx-benchmark.py artifacts/benchmark/my-mlx-run
```

脚本支持 `BENCH_MODELS`（逗号分隔）和 `BENCH_PORT`；自动清理自己启动的服务，不停止用户的 8080 服务。输入文件为 [scenarios.json](data/scenarios.json)。

## 归档数据

- [环境与测量定义](data/2026-10-04-mlx-models/metadata.json)
- [模型 revision 与量化信息](data/2026-10-04-mlx-models/model-sources.json)
- [逐请求结果、输出、SSE 事件及时间戳](data/2026-10-04-mlx-models/results.jsonl)
- [汇总统计](data/2026-10-04-mlx-models/summary.json)
- [内存摘要](data/2026-10-04-mlx-models/memory-summary.json)

没有根据 6 个样本报告 P95；没有测满上下文、高并发、持续负载或功耗。所有耗时仅代表该桌面会话，后续运行会受温度、后台任务等影响。
