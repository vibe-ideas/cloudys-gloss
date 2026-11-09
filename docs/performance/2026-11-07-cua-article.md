# Cua 整篇文章：极速离线翻译

> **已撤回的历史方案。** 2026-11-08 按用户要求移除了浏览器翻译实现及入口，恢复纯模型翻译。下文 10–20 秒等结果属于浏览器语言包方案，不能用于描述当前模型翻译速度；保留原记录供审计。

2026-11-07，Apple M4 Pro，macOS 27.0.1。测试文章为 [Cua Driver Bench](https://github.com/trycua/cua/blob/0757beeb0b45f0b886628ba30a04f0dfbc0ca1c2/blog/cua-driver-bench.md)，固定到 `0757bee`。生产语义提取识别 81 个文本块、23,126 字符，涵盖整篇文章，不包含图片内文字。

## 实测结果与口径

| 场景 | 整篇耗时 | 首段 | 完成情况 |
| --- | ---: | ---: | --- |
| 原版 provider 顺序调用 | 172.01 秒 | 1.40 秒 | 81/81；55 次请求，14 次单段补译 |
| Qwen3 关闭思考，provider 两轮 | 105.05、127.61 秒 | 0.82、0.96 秒 | 均 81/81；每轮 49 次请求，8 次补译 |
| 完整扩展，模型模式，文章 HTML 回放 | 106.05 秒 | 1.46 秒 | 81/81 |
| 极速模式，真实 GitHub 页面，生产页面链路，两轮 | **20.33、17.98 秒** | 2.58、2.53 秒 | **均 81/81；各 1 次模型补译** |
| 极速模式，可复跑脚本，固定 commit 页面 | **10.32 秒** | 1.12 秒 | **81/81；1 次模型补译** |
| 本次布局与补译优化前，同一固定页面 | 21.27 秒 | 3.16 秒 | 81/81；模型补译 680 字符 |
| 本次优化后，同一固定页面，两轮 | **16.06、16.75 秒** | 2.28、2.29 秒 | **均 81/81；模型补译 102 字符** |

本次三轮都新建 transport，未复用扩展结果缓存，语言包已就绪；使用同一份文章、同一模型、相同生产页面链路及 Node 模型桥接。优化后两轮比本次优化前样本快约 21%–24%；小样本不构成稳定延迟保证，也不拿此前 10.32 秒样本作为本轮基线。浏览器翻译调用从 185 次减少到 133、132 次，模型只补译失败句子，其他句子直接复用本轮已校验的结果。

真实 GitHub 提交栏翻译前为 44px；旧布局翻译后增至 188.67px，新布局两轮均保持 44px。紧凑的单行导航、提交作者、提交消息采用悬停或键盘焦点查看译文，不插入占用行高的双语内容；正文段落仍直接显示双语。文件名、代码标识及提交哈希保留原文。Chrome / Firefox 的 1200px、700px 布局用例还检查了原坐标、行高和关闭翻译后 DOM 恢复。

极速模式三轮均包括实际页面扫描、自动滚动、逐块显示和必要的真实模型补译。使用生产 `PageTranslator`、`BrowserTranslationTransport` 的编译脚本注入真实页面，模型回退由 Node 桥接调用生产 provider；没有加载完整扩展的消息层。它验证了真实浏览器内的生产页面链路，**不能直接称为已安装扩展发布版的完整 E2E 跑分**。可复跑脚本固定到 commit 页面，前两轮在 main 页面；内容相同，页面外壳和浏览器内部缓存状态不同，不把第三轮与前两轮的差异归因于代码提速。前几行使用不同层级及页面布局，不用于计算严格提速倍数。

三轮极速测试的语言包均已就绪，无扩展结果缓存。首次准备语言包曾单独测得 **10.68 秒**，未计入上述三轮，不承诺首次下载也在 30 秒内完成。浏览器内部缓存、服务提示词缓存均未清理；日常桌面应用保持打开，样本不足以统计 P95。第三轮记录的浏览器 UA 为 Chrome 156。

本机 8080 实际运行 `mlx_lm.server` 0.32.0，模型为 `Qwen/Qwen3-1.7B-MLX-4bit`，本地 revision `21457c6f51ed54a7c16e988c0844db973815c137`，温度 0、并发 1。本次没有替换用户的常驻服务。

## 改动

设置新增“网页翻译引擎”，默认“极速离线（浏览器优先）”。支持的桌面 Chrome 使用浏览器语言包在本机翻译；模型模式可继续使用自选服务。[Chrome 官方说明](https://developer.chrome.com/docs/ai/translator-api)介绍了离线语言包、用户激活和支持范围。

- 点击悬浮球时立即准备语言包，保留用户激活；一页复用同一实例。
- 代码、路径、常量和可识别的专名先保护再翻译。允许标记大小写改变，恢复时逐项检查数量；缺失、重复或未知标记均拒绝。
- 长段落校验失败时按句重试，逐句检查并按原顺序组合；只将仍失败的句子交给模型，全部句子完整有效后才显示整段。补译失败不会再重复提交整段。
- 同一页缓存通过校验的离线译文，最多 256 条、128,000 个源文加译文字符；不缓存混合模型补译结果，手动重翻绕过缓存，页面失效时清空。
- 取消立即结束当前等待，迟到结果不回写；语言包准备最多等待 20 秒，之后退回模型。页面失效时释放实例。
- 本机原版 Qwen3 的网页翻译和补译增加 `/no_think`。当前权重的聊天模板没有读取 `enable_thinking` 参数，单独发送该参数的实验没有明显收益。远端模型、Qwen3.5、词卡和输入框不应用这个软开关。

Firefox 和不支持该 API 的浏览器使用模型，**没有验证它们能在 30 秒内完成这篇文章**。在标准 Playwright Chromium 中，真实语言包准备曾卡住，完整扩展极速测试因首段超过 125 秒而失败；随后增加了 20 秒准备上限并用可控测试覆盖。未把该轮失败计入通过数据，也未把该环境当作真实极速跑分来源。

## 完整性、质量与验证

两轮页面测试均检查全部 81 个源块得到正式译文。固定 18 例质量语料的自动检查通过，包括数字、否定、代码、常量及注入文本；这不等于逐例语义质量达标。离线引擎仍有“收费”译为“充电”、“转机”译为“连接”等缺陷，模型也有既有误译。需要核对表达时可切换模型模式。

8 路模型并发实验约 43 秒但有 2 个连接失败；大批次实验触发大量补译，约 61 秒；原生后端的直接单段实验约 124 秒。另测的 OPUS/CT2 专用模型约 20 秒，但出现截断、时间及词义错误。这些实验均未作为达标方案接入。

验证：lint、TypeScript、567 条单元测试通过；Chrome / Firefox 构建通过；网页重试、设置及离线引擎相关 E2E 共 16 条通过、6 条按浏览器跳过。新增场景包括：

- 浏览器支持极速翻译时，在用户激活期间准备语言包并显示逐段译文，不请求模型。
- 极速引擎丢失代码标记时，只补译失败段落，成功段落保留离线结果。
- 长段落按句修复后，所有原句按原顺序通过才显示整段。
- 下载超时转模型、独立取消、迟到实例释放，以及模型模式的端点兼容。

本次追加验证：lint、TypeScript、573 条单元测试通过；新增的 Chrome / Firefox 紧凑行布局 E2E 均通过，离线引擎及网页重试 E2E 12 条通过、2 条按浏览器跳过。Chrome 构建及 Firefox 打包通过。单元测试新增失败句补译、补译取消、不重复请求整段、同页缓存与手动绕过、容量淘汰、文件名和哈希保留场景。原始结果与截图位于本机 `artifacts/layout-speed-review/{before,after,after-repeat}/`。

## 复跑

模型层脚本为 [benchmark-article.ts](../../tests/performance/benchmark-article.ts)，完整扩展 HTML 回放位于 [translation.spec.ts](../../tests/live/translation.spec.ts)。下载固定网页后，脚本会从 HTML 中提取 article，生成 `replay.html`：

```sh
rtk proxy curl -fLsS https://github.com/trycua/cua/blob/0757beeb0b45f0b886628ba30a04f0dfbc0ca1c2/blog/cua-driver-bench.md -o /tmp/cua-article.html
rtk proxy env BENCH_ARTICLE=/tmp/cua-article.html BENCH_OUTPUT=artifacts/my-article BENCH_EXTRACT_ONLY=1 pnpm dlx tsx@4.23.15 tests/performance/benchmark-article.ts
```

去掉 `BENCH_EXTRACT_ONLY` 则真实调用模型。`BENCH_LEGACY=1` 仅移除新加的 `/no_think` 作对照；并发、批次上限分别使用 `BENCH_CONCURRENCY`、`BENCH_ITEMS`、`BENCH_CHARS`。每次输出目录必须不存在。

真实浏览器复跑脚本为 [benchmark-browser-article.mjs](../../tests/performance/benchmark-browser-article.mjs)，由 ego-browser 的 TaskSpace 调用。先在仓库构建两份测量脚本：

```sh
rtk proxy node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = await import(createRequire(require.resolve('wxt')).resolve('vite'));
const common = { configFile: false, publicDir: false };
await build({ ...common, build: { outDir: 'artifacts/browser-article-runtime', emptyOutDir: false,
  lib: { entry: 'tests/performance/browser-article-entry.ts', formats: ['iife'], name: 'CloudysArticleBench', fileName: () => 'ui.js' } } });
await build({ ...common, build: { outDir: 'artifacts/browser-article-runtime', emptyOutDir: false,
  lib: { entry: 'src/model/provider.ts', formats: ['es'], fileName: () => 'provider.mjs' } } });
JS
```

随后用 `ego-browser nodejs` 导入该模块，将当前 TaskSpace、仓库绝对路径 `root`、新的输出目录 `output` 传给 `benchmarkBrowserArticle()`。它会打开固定文章、点击测试入口、完成全部块、保存浏览器版本/源文哈希/译文/截图，并恢复原文。语言包下载计入该次页面计时，缓存状态在结果中注明。

汇总数据归档在 [summary.json](data/2026-11-07-cua-article/summary.json)。原始实验保留在本机 `artifacts/cua-article/`：`before`、`production-after`、`chrome-full-ui.json`、`chrome-full-ui-repeat.json`、`reproducible-ui-v2/results.json`、`chrome-production-fast-v4.json`、`chrome-native-quality.json`，不作为已批准的语义质量基线。
