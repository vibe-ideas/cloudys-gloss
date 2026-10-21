# 翻译质量回归与模型切换

质量用例、运行器、自动检查和审阅基线统一放在 `tests/`；本页说明使用方法。不要把 Zod 通过、输出含中文或 TPS 更高写成翻译质量合格。

运行环境为项目的 Node.js / pnpm，加 Python 3（报告工具仅用标准库）。本机 MLX 横向比较默认使用 `pnpm model:install` 安装的 mlx-serve；任意兼容 API 的单模型评测不需要安装 MLX。

## 目录

```text
tests/
  quality/
    holdout.json         # 第一组未参与初始调参的验收题，失败后作为回归集
    acceptance.json      # 第二组独立验收题，候选冻结后执行
    dictionary-cases.json # 词卡语境、词性与释义要求
    paragraph-retry-cases.json # 用户反馈的长段落持续失败回归
    cases.json           # 版本化固定语料、参考译文、语义要求和规则
    corpus.ts            # Zod 校验与确定性检查
    live.test.ts         # Vitest 调用真实 provider，保存原文对应结果
    vitest.config.ts     # 独立于普通单测，不意外调用付费 API
    run-mlx.py           # 顺序启动已缓存的 MLX 模型进行横向比较
    report.py            # 生成对照报告、校验审阅、检测质量回归
    baselines/           # 经审阅的输出、评分和语料快照
  performance/           # 后端/TPS 测试脚本与公共输入
  unit/                  # 包括质量检查器与报告门槛自身的回归测试
```

活跃语料为 [cases.json](../../tests/quality/cases.json)，当前 18 例：日常双段、技术双段、长文批量、单块多段、价格日期、否定条件、百分点、温度单位、两种 bank、light、习语、指代关系、代码路径、引用指令、短按钮、不确定性和反讽。每例包含独立标题、参考中文、必须保留的信息点以及检查规则。参考中文是可接受译法之一，不做逐字相等断言。

## 三层判定

1. **调用与结构**：使用实际 `OpenAICompatibleProvider.translate` 和流式回调，包含项目的校验、JSON 回退、超时逻辑。无扩展结果缓存、浏览器 DOM 或后台排队。
2. **自动检查**：数量、空段、中文存在性、明确数字/单位/标识符、少数确定性错义。`error` 导致真实测试失败；`review` 只提示疑似遗漏或语义风险，不直接扣主观分。近义词和格式允许适当变体。这些规则不是通用语义理解器，尚不能覆盖所有数值改写、否定反转或增译。
3. **逐例审阅**：结合原文、参考译文和 requirements，评价忠实度、完整性、自然度，并写出具体证据。当前归档由 **Codex 逐例审阅**，不是独立人工盲评，也没有调用一个付费 judge 模型。评分者和方法必须署名，后续可以由人复核。

同样的语义错误应跨模型采用同一尺度。自动通过仍可能有重大错译；自动失败也可能是规则漏收合理表达，需要人工确认，不应直接改正确译文来迎合规则。

## 固定评分尺度

每个维度独立按 0–4 评分：

| 分数 | 忠实度 | 完整性 | 自然度 |
| --- | --- | --- | --- |
| 4 | 信息、关系、限定准确 | 全部信息点保留 | 通顺地道 |
| 3 | 少量不影响主要理解的偏差 | 个别次要细节弱化 | 有轻微翻译腔 |
| 2 | 存在影响理解的局部错义 | 丢失重要信息点 | 生硬但可理解 |
| 1 | 主要关系或结论错误 | 大幅漏译 | 语法混乱或未译词影响阅读 |
| 0 | 无有效译文或完全错误 | 无有效信息 | 不可理解/无输出 |

数字/日期导致事实改变、执行顺序或否定关系错误、整段漏译、执行被引用指令等标为 `critical=true`。语气不够自然不自动算严重错误，但可因忠实度或自然度不足而不通过。

一条请求“可接受”需要自动硬性检查通过、无调用错误、已有有效审阅、无严重错误，并且忠实度 ≥3、完整性 ≥3、自然度 ≥2。一个用例需要所有重复轮次均可接受。默认重复两轮；这检验小样本重复性，不代表模型在所有采样和输入下稳定。

## 运行任意 OpenAI-compatible 模型

```sh
MODEL_BASE_URL=http://127.0.0.1:8080/v1 \
MODEL_NAME=mlx-community/Qwen2.5-3B-Instruct-4bit \
QUALITY_OUTPUT=artifacts/quality/my-candidate \
pnpm test:quality
```

可选 `QUALITY_CORPUS=tests/quality/holdout.json` 选择另一组固定语料（哈希按实际文件计算），`QUALITY_TASK=dictionary` 单独执行词卡检查；结果输出到 `QUALITY_OUTPUT/dictionary`。

可选 `MODEL_API_KEY`、`MODEL_REVISION`、`QUALITY_REPEATS=2`、`QUALITY_RUNTIME`、`QUALITY_PROMPT_CACHE`、`QUALITY_THINKING`。`QUALITY_RUNTIME` 与 `QUALITY_PROMPT_CACHE` 记录已运行服务的实际配置。`QUALITY_THINKING=enabled` 且运行时为 mlx-serve 时会向请求注入思考开关和预算，这是实验管线，不能冒充默认生产请求。温度固定 0、串行、超时 120 秒。自选远程接口可能产生费用，但只发送仓库固定合成文本；不读取私人网页。结果不保存 API Key。

输出目录不得已有 `results.json`，避免混合两次运行。输出包含 `metadata.json`、`results.json`、`review-template.json` 和 `pipeline.json`（代码与额外请求参数快照）；记录语料哈希、provider 哈希、模型 revision（未设置则标为 unrecorded）、每次译文、回退请求数和耗时。失败样本也保留，测试继续执行其余用例。中断产生的不完整结果不能通过报告校验。

## 本机三模型对照

预先下载模型后：

```sh
QUALITY_OUTPUT=artifacts/quality/my-comparison \
pnpm test:quality:mlx
```

默认顺序测试 Qwen2.5 3B、Qwen2.5 1.5B、Qwen3 1.7B 的 MLX 4-bit 版本；可用 `QUALITY_MODELS` 传入逗号分隔的其他仓库 ID。`QUALITY_PORT` 默认 18082。启动时固定本机 snapshot 路径并记录 revision，禁止下载混入计时；模型缺失时先下载，不把联网失败当质量失败。mlx-serve 固定并发 1、前缀缓存 1 条 / 128MB、buffer pool 256MiB，默认关闭 thinking，服务预热后测量。测试其他架构前应核对上游支持列表。

只停止测试自身启动的服务，不修改插件默认配置和 8080 服务。普通后台应用可能影响耗时，因此质量比较中的时延只是辅助指标；TPS 方法见 [性能测试](../performance/2026-10-04-mlx-models.md)。

复现历史 mlx-lm 结果时，额外设置 `QUALITY_BACKEND=mlx-lm MLX_PYTHON=/path/to/mlx-env/bin/python`；该路径关闭 prompt cache，保留旧环境即可，不用于默认部署。

始终思考的模型可显式设置 `QUALITY_THINKING=enabled`，运行器将记录配置：mlx-serve 使用 `--reasoning-budget -1`（禁用时为 `0`），也可用 `QUALITY_REASONING_BUDGET` 指定预算；相同预算同时传给请求，额外请求参数纳入 providerHash，历史 mlx-lm 使用 `enable_thinking=true`。默认仍为 `disabled`。该参数是否受支持必须核对模型模板，不能仅凭传参就声称实际关闭了思考；例如 LFM2.5-2.6B 的模板始终开启思考，应使用 `enabled`，单独标注延迟比较的差异。

## 审阅与比较

把每个运行目录的 `review-template.json` 复制为 `reviews.json`，填写 reviewer、method、三维评分、critical、notes。每条 notes 必须解释具体优点/问题；同一用例的完全相同输出可复用一条评分，不同输出必须分别审阅。

```sh
pnpm quality:report path/to/model-a-run path/to/model-b-run \
  --output artifacts/quality/comparison.md
```

报告逐例并列原文、参考译文、各模型实际译文、自动问题和评分理由，另写 JSON 汇总。**任何待审阅样本都返回非零退出码**，不会计为合格。审阅绑定 corpusHash、providerHash、model 和 outputHash，不能把旧分数套给改过的译文。语料变化或结果不完整同样拒绝比较。

发布前要求所有用例合格：

```sh
pnpm quality:report path/to/candidate --gate
```

与现有已审阅基线比较，禁止在旧模型已经合格的用例上退步：

```sh
pnpm quality:report path/to/candidate --baseline path/to/approved-baseline
```

报告默认只生成比较；`--gate` 是全量达标门槛，`--baseline` 是无退步门槛，两者可合用。已有基线可以记录已知缺陷，**记录基线不等于批准发布**。provider 版本不同默认拒绝冒充纯模型对比。提示词或管线优化时可以显式传 `--allow-provider-change`，报告会标注管线变化及各版本哈希。

## 维护约定

- 普通 `pnpm check` 验证质量检查器、报告门槛与参考译文，不启动模型，且不因模型质量差而长期变红。
- 真实模型测试失败要保留具体错误与输出，修模型/配置/实现后重新跑；不要删除困难用例来提高通过率。
- 修改语料、参考答案或规则时提升 version。历史运行连同当时的 `cases.json` 快照存入 `tests/quality/baselines/<日期>/`；历史报告可用 `--corpus` 指向快照复现。不同语料版本不能直接计算无退步。
- 提交经过审阅的结果、评分及摘要；失败探索的原始结果可另存 `baselines/<日期>/experiments/` 并标注未审阅，不能算合格基线。日志与下载文件保留在被忽略的 `artifacts/`。质量文档放 `docs/`，可执行用例和基线只在 `tests/` 维护。
- 本轮曾把 Retry 的“重新尝试”误报为失败；v1.0.1 扩展了合理同义表达，并允许“AbortController 的 abort() 方法”的可识别 API 表述。三模型随后全部重跑，不沿用旧规则的通过率。

本轮对照结论见 [2026-10-04 翻译质量报告](../performance/2026-10-04-translation-quality.md)。

服务迁移对照见 [mlx-serve 性能与质量](../performance/2026-10-05-mlx-serve.md)，18 例逐条输出与审阅已归档到 `tests/quality/baselines/2026-10-05-mlx-serve/`。

## 90% 目标与独立验收

单条评分标准不变；按“所有重复轮次都合格”的用例数计算比例，不能以请求数或自动检查通过率代替语义质量。比如 18 例需至少 17 例通过，12 例需至少 11 例通过。

```sh
pnpm quality:report path/to/candidate \
  --baseline path/to/baseline --allow-provider-change \
  --min-pass-rate 0.9 --no-critical --min-repetitions 2
```

任何待审阅结果仍然失败；`--no-critical` 单独阻断严重错误，`--gate` 仍要求 100%。未参与提示词选择的题目才能叫独立验收集；一旦看过结果并据此继续选择模型或调参，就应将其转为回归集并另出新题。固定小样本的通过率不能外推为所有网页准确率。

词卡的 Zod 通过、词性/释义粗规则通过与专家内容评分分别统计；IPA 缺失不是错误音标，但也不能计成内容完整。内置音标词典按 US / UK 精确查词，多读音并列，未收录的口音或整短语留空。来源与可复现构建见 [离线音标](offline-pronunciation.md)。
