# YouTube 双语字幕验证与缓冲优化（2026-10-18）

## 结论与口径

实现完整字幕轨道预取，以及无法读取时的当前 CC 翻译。初版虽下载完整字幕，翻译调度只处理当前位置后约 8 条；用户在真实视频上反馈跟不上语速后，改为当前句先返回，再连续分批填充两分钟缓冲。暂停时仍预翻译后文。

这里的“两分钟”是调度目标，不是已经翻译完成的保证。每次最多检查 64 个合并片段、每批 8 条 / 2,400 字符；倍速按实际观看时间放大目标。冷启动、拖动到很远的位置、实时 CC 降级、模型吞吐不足时仍可能等待。本报告不把测试服务的返回速度当成真实 MLX TPS。

## 实际浏览器检查

在用户现有 Chrome、现有插件配置下，打开指定视频 [Building on the Codex Harness — Dominik Kundel, OpenAI](https://www.youtube.com/watch?v=9WiBJRO84yY)，通过 Chrome 扩展管理页重新加载本地开发构建后测试。

- 原视频存在英文自动字幕。
- 实际播放器出现“双语”按钮；开启后原文与中文同时出现。
- 优化版本的按钮提示为“字幕轨道 · 提前翻译”，确认本次走完整轨道，而非实时 CC 降级。
- 观察到后续技术内容的中文正常回填。未采集逐帧延迟或连续整片缺译率，因此不声称已经量化消除所有延迟。
- 未改用户模型配置，未发布新版本。Firefox 的真实网站验收未在本轮单独进行，其功能由真实 Firefox 浏览器的受控播放器 E2E 验证。

## 自动化验证

环境为本机 macOS，Playwright Chromium 与 Firefox Developer Edition；使用隔离配置目录、真实扩展后台和 HTTP 模型模拟服务。字幕页面是测试自有 HTML，路由到 YouTube origin 以走生产入口和页面桥接，不代表远端 YouTube 可用性测试。时间轴使用真实 600 秒 WebM，支持 HTTP Range；没有用页面脚本替换 `currentTime` 来伪造拖动成功。

- `pnpm check`：lint、typecheck、448 个单测通过。
- `pnpm exec playwright test tests/e2e/video/youtube.spec.ts tests/e2e/reading/source-language.spec.ts`：10 个用例通过，Chrome / Firefox 各 5 个。
- Chrome MV3、Firefox MV2 构建通过，共用业务实现。

稳定场景包含：

1. 首句流式译文在请求完成前显示；长视频只翻译有限窗口；真实媒体拖动到新位置显示对应字幕；全屏可见；关闭恢复原 CC。
2. 完整轨道返回空内容时，当前 CC 仍可翻译；503 错误提供原因与重试；中文技术字幕不重复请求。
3. SPA 换视频仅保留一个字幕开关与覆盖层；广告期间隐藏字幕；原先开启的 CC 在关闭功能后保留。
4. 暂停状态持续预译两分钟，跳到已缓存位置不重新请求该句。
5. 相邻网页中英文混合内容的提取回归通过。

对应测试：[浏览器场景](../../tests/e2e/video/youtube.spec.ts)、[字幕解析](../../tests/unit/video-captions.test.ts)、[播放调度](../../tests/unit/video-scheduler.test.ts)、[网页提取排除字幕](../../tests/unit/blocks.test.ts)。

## 缓冲与资源界限

调度单测固定输入 1,000 条、每条 3 秒的字幕，暂停在起点。优化后首批只请求当前句，后续 5 批补齐 40 条，合计预翻译到第 120 秒；不会请求第 123 秒或整片。该结果验证调度覆盖范围，不是模型速度基准。

普通网页 content script 约 100 KB，本次视频逻辑位于 YouTube 专属脚本；页面桥接约 3 KB，点击开启才注入。内存会话译文最多 500 条，完整字幕响应上限 4 MiB。播放定位采用二分查找，不逐帧遍历完整轨道。

测试自有 `timeline.webm` 约 28 KB，使用纯色合成画面，不包含第三方影片内容。生成方法见 [fixture 说明](../../tests/e2e/video/README.md)。测试截图与临时日志保留在忽略目录，不公开用户浏览器窗口或账户信息。
