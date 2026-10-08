# EmbeddingGemma 2：科技词库检索与本地开销实测

2026-10-07，Apple M4 Pro / 48 GiB，macOS 27.0.1，Python 3.12.11。

**结论：值得作为科技词库的语义检索、同词头上下文选义工具。** 本机 MLX 4-bit、64 MiB 分配器缓存配置，热查询中位数 7.24 ms、p95 7.89 ms；48 个固定合成场景的首位命中为 46/48，同词头候选消歧为 24/24。优先验证 256 维方案，128 维在本轮有明显排名退步。

这是候选排序测试。EmbeddingGemma 2 输出向量，全文翻译、中文解释、IPA 和例句仍需要生成模型或词典数据。本轮没有替换插件的翻译模型，也没有把新模型设为常驻服务。

## 发布信息与固定版本

Google 于 2026-10-06 发布。模型包含约 270M 参数的文本模块，完整多模态模型约 740M 参数，原生输出 768 维，支持截短到 512/256/128 维，授权 Apache 2.0。任务前缀和截短后的再次归一化会影响检索结果；应使用 BF16 或 FP32，不能直接转成 FP16。[发布说明](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/)、[官方模型卡](https://huggingface.co/google/embeddinggemma-2)、[开发指南](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/)。

| 项目 | 本轮固定值 |
| --- | --- |
| 原模型 | `google/embeddinggemma-2`，`914f7f89142e33e77833254d9c9b90c3cef7303b` |
| MLX 量化模型 | `mlx-community/embeddinggemma-2-4bit`，`8ab839e127cb8cb305edd71fb7a02c82f2d49ab3` |
| MLX 实现 | `Blaizzy/mlx-vlm`，`3d87e88402f307efbf68e568971aa887ee7d9ed0` |
| Python 推理栈 | Sentence Transformers 6.1.0、Transformers 5.19.0、PyTorch 2.14.1、MLX 0.32.3 |
| 量化配置 | affine 4-bit，group size 64；非量化权重和激活沿用检查点 BF16 |

MLX 转换需要上述实现分支；发布时通用稳定包未必含相同架构支持。本文测试的是固定版本，不自动跟随分支更新。[转换模型说明](https://huggingface.co/mlx-community/embeddinggemma-2-4bit/tree/8ab839e127cb8cb305edd71fb7a02c82f2d49ab3)、[实现源码](https://github.com/Blaizzy/mlx-vlm/tree/3d87e88402f307efbf68e568971aa887ee7d9ed0)。

首次尝试纯文本加载时仍需要 Pillow 和 torchvision，因为官方 Python processor 会导入图像处理组件。复现环境已锁定这两项依赖。没有启用远程自定义模型代码。第一代 `google/embeddinggemma-300m` 的匿名权重访问返回 401，因此未作第一代本机对照；基线使用 BM25。

## 测试口径

[固定语料](../../tests/quality/embedding-tech-cases.json)在首次质量推理前写定，包含 48 个条目和 48 个查询，每个查询人工标注一个目标条目。

| 场景 | 数量 | 输入与目标 |
| --- | ---: | --- |
| 词义消歧 | 24 | 12 个多义词各两种语境，例如模型 / 电路的 transformer、分词 / 身份凭据的 token、操作系统 / 数学的 kernel |
| 中英检索 | 8 | 中文描述检索英文说明，例如量化、RAG、垃圾回收、OAuth |
| 英文检索 | 8 | 英文释义或改写检索英文条目，例如 WebAssembly、事务、注意力 |
| 代码检索 | 8 | 中英文功能描述检索 TypeScript 示例，例如并发限制、取消、防抖、旧选区结果隔离 |

每条查询都搜索全部 48 个条目。词义场景另外计算“只在相同词头候选中排序”的首位命中，候选来自人工词头字段，不能用这个指标代替开放检索结果。

查询使用官方 `SearchQuery` / `CodeRetrieval` 前缀；条目使用 `title: {title} | text: {content}`。缩短向量后重新 L2 归一化，再按余弦相似度排序。BM25 使用英文词、数字标识符和中文连续双字，不做翻译或同义词扩展；纯中文查询对纯英文条目通常没有词面交集。

**这些是小规模人工合成诊断，条目短、候选少，而且每个查询只有一个目标标注。** 它们不是随机抽样的真实网页准确率，也没有覆盖大型混合词库、长 PDF、未收录词、拒绝阈值或图片检索。相关但不等于目标条目的结果，也会被严格目标标注记为未命中。

## 检索结果

| 检索方案 | 全库首位命中 | 前三位命中 | 同词头消歧首位命中 |
| --- | ---: | ---: | ---: |
| BM25 | 29/48（60.4%） | 32/48（66.7%） | 19/24（79.2%） |
| PyTorch MPS BF16，768 维 | 46/48（95.8%） | 48/48 | 24/24 |
| PyTorch MPS BF16，512 维 | 47/48（97.9%） | 48/48 | 24/24 |
| PyTorch MPS BF16，256 维 | 46/48（95.8%） | 48/48 | 24/24 |
| PyTorch MPS BF16，128 维 | 39/48（81.3%） | 48/48 | 24/24 |
| MLX 4-bit，768 维 | 46/48（95.8%） | 48/48 | 24/24 |
| MLX 4-bit，512 维 | 46/48（95.8%） | 48/48 | 24/24 |
| MLX 4-bit，256 维 | 46/48（95.8%） | 48/48 | 24/24 |
| MLX 4-bit，128 维 | 40/48（83.3%） | 48/48 | 24/24 |

MLX 默认缓存与 64 MiB 缓存配置的所有质量排名一致。BF16 与 4-bit 在 768 维的中英、英文、代码三个类别均为 8/8；全库词义类为 22/24。512 维的一个样本变化不足以得出“512 比 768 更准确”的普遍结论。

具体失误：

- `The laptop cannot allocate enough memory to load the model.` 在 768 维中更偏向模型推理或量化条目，标注的计算机内存义项排第三。先按 `memory` 词头限定候选时会选对。
- `We restart the container when its health check fails.` 更偏向 Kubernetes 编排，软件容器条目排第二。限定 `container` 候选时会选对。
- MLX 128 维时，并发限制代码被批处理说明超过，数组分块代码被垃圾回收说明超过，LRU 缓存代码被隐藏物资义项超过。这说明这里的 128 维仍需要更多验证。

4-bit 不是数值无损转换。对本轮 48 个条目，原 BF16 与 MLX 4-bit 的向量余弦一致性中位数约 0.980、最低约 0.968；查询向量中位数约 0.986、最低约 0.981。768 维首位命中相同，不代表更大语料也不会退步。

## 延迟、批处理与启动

单查询计时包含分词、编码、池化、归一化及 NumPy 输出，并在 GPU 同步后结束。先预热五次，再用固定随机顺序跑三轮，每轮 48 个不同查询，共 144 次；没有应用结果缓存。**不包含 HTTP、插件 messaging、浏览器显示或译文生成。**

| 运行方案 | 单查询中位数 | 单查询 p95 | 一批 32 个输入的中位耗时 | 批处理输入吞吐 |
| --- | ---: | ---: | ---: | ---: |
| PyTorch MPS BF16 | 22.49 ms | 24.22 ms | 122.67 ms | 260.9 条/秒 |
| MLX 4-bit，默认分配器缓存 | 7.19 ms | 7.90 ms | 69.24 ms | 462.1 条/秒 |
| MLX 4-bit，64 MiB 分配器缓存配置 | 7.24 ms | 7.89 ms | 69.57 ms | 459.9 条/秒 |

批处理使用固定 32 个非代码输入，每个 batch size（1/8/16/32）重复三次并交替顺序。MLX 64 MiB 配置下，用 batch size 1 逐条处理这 32 个输入，中位耗时 241.29 ms；batch size 32 为 69.57 ms，约快 3.5 倍。输入短、长度接近，不能直接外推到长网页段落。

这里比较了两种不同精度和实现：不能把时间差完全归因于 MLX 后端。768/512/256/128 维共用一次 768 维编码后截短，所以缩短向量主要节省索引空间，没有让编码器少做计算。

权重已下载到磁盘后，第一次 BF16 运行测得加载 1.06 s、首次编码 1.52 s；第一次 MLX 4-bit 运行加载 4.75 s、首次编码 0.73 s。后续 64 MiB 配置进程加载 3.54 s、首次编码 25.74 ms，可能受磁盘及持久化 Metal 编译缓存影响。没有清空 OS / Metal 缓存，不能把后一次首次编码当成真正冷启动。加载区间对 MLX 还包含 loader 的延迟导入，BF16 库在计时前已导入；这些加载数字用于定位，不作为后端启动速度排行榜。

## 内存与磁盘

| 指标 | PyTorch BF16 文本模块 | MLX 4-bit 文本模块，64 MiB 缓存配置 |
| --- | ---: | ---: |
| 实际加载的参数 / 打包权重字节 | 516.9 MiB | 145.5 MiB，包含量化 scales / offsets |
| Python 进程 RSS 采样峰值 | 1.07 GiB | 1.21 GiB |
| 活跃计算分配的采样峰值 | MPS tensor 555.7 MiB | MLX 内建峰值计数约 513.7 MiB |
| 分配器缓存采样峰值 | MPS driver 总计另报，不能当独立缓存 | 约 67.4 MiB |
| 下载的完整检查点文件 | 1.526 GB | 1.131 GB，其中 safetensors 1.098 GB |

采样周期 20 ms。RSS、MPS driver、活跃张量和分配器缓存是不同且可能重叠的口径，不能相加冒充物理占用，也不能把权重大小冒充完整服务开销。Python / Transformers / 图像加载依赖和映射文件仍有开销。

MLX 默认配置的分配器缓存采样峰值约 1.90 GiB；设置 64 MiB 后，质量不变、热查询时间接近，峰值约 67.4 MiB。这个配置控制可复用缓存目标，不是进程总内存硬限制，瞬时采样也可能略高于目标。

模型配置中禁用了视觉、音频编码器，但下载的仍是完整检查点。未来正式集成应导出文本专用资产，再复测实际服务进程。官方手机端量化 RAM 数字不等于本机 Python 进程 RSS。

float32 向量裸数据按 10 万个条目计算：768 维约 293 MiB、256 维约 98 MiB、128 维约 49 MiB，尚不包含词条正文、数据库元数据和索引。本轮 256 维保留相同首位命中，可作为下一轮较大词库验证的起点。

## 对插件的建议

现有 IDB 精确词头查询依然是最快的首步。对于同一词头的多个候选义项，可先用当前选区上下文排序，再把较相关的词条交给生成模型；未精确命中的科技短语，也可以额外尝试语义候选检索。向量检索不会补出词库缺少的释义、IPA 或例句，也不能代替上下文生成。

建议从 **文本专用 MLX 4-bit、256 维、显式分配器缓存配置**的小规模可选实验开始；模型冷启动和语料编码应避开普通精确查词的快速路径。是否能改善实际翻译质量或减少生成等待，需要继续测插件端请求与输出，不从这里的 7 ms 编码时间推断。

## 复现与证据

依赖安装到独立实验环境，不更新日常 `mlx-serve` 环境；首次运行会下载上述检查点。

```sh
uv venv --python 3.12 artifacts/embeddinggemma2-venv
uv pip install --python artifacts/embeddinggemma2-venv/bin/python -r tests/performance/embedding-requirements.txt

artifacts/embeddinggemma2-venv/bin/python tests/performance/test_embedding_metrics.py

artifacts/embeddinggemma2-venv/bin/python tests/performance/benchmark-embeddings.py \
  --model google/embeddinggemma-2 \
  --revision 914f7f89142e33e77833254d9c9b90c3cef7303b \
  --output artifacts/embeddinggemma2/mps-bf16.json

artifacts/embeddinggemma2-venv/bin/python tests/performance/benchmark-embeddings.py \
  --backend mlx --model mlx-community/embeddinggemma-2-4bit \
  --revision 8ab839e127cb8cb305edd71fb7a02c82f2d49ab3 \
  --mlx-cache-mib 64 \
  --output artifacts/embeddinggemma2/mlx-4bit-cache64.json
```

复测输出放 `artifacts`，避免覆盖归档基线。通用脚本也支持 `--device cpu --dtype float32`，本轮没有执行 CPU 跑分。

- [固定语料与可读场景名](../../tests/quality/embedding-tech-cases.json)
- [本地模型实测脚本](../../tests/performance/benchmark-embeddings.py)
- [依赖锁定](../../tests/performance/embedding-requirements.txt)
- [测量逻辑验证：五项测试](../../tests/performance/test_embedding_metrics.py)
- [BF16 原始逐例排名、延迟及内存](../../tests/performance/baselines/2026-10-07-embeddinggemma2/mps-bf16.json)
- [MLX 默认缓存原始结果](../../tests/performance/baselines/2026-10-07-embeddinggemma2/mlx-4bit.json)
- [MLX 64 MiB 配置原始结果](../../tests/performance/baselines/2026-10-07-embeddinggemma2/mlx-4bit-cache64.json)

项目 `lint / typecheck / 356 项 Vitest` 通过；新增五项 Python 测量测试通过。此次为离线检索实验，没有新增浏览器业务行为，未重跑浏览器 E2E。
