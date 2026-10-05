# 校验与浏览器测试

性能测试的方法、输入和结果见 [性能文档目录](../performance/README.md)。浏览器 E2E 使用可控模型夹具验证行为；真实模型 smoke 和 TPS benchmark 单独运行，避免把模型不稳定性混入普通测试。

翻译质量使用独立的 `pnpm test:quality`，固定语料和审阅基线统一维护在 `tests/quality/`。模型切换需比较忠实度、完整性和自然度，见 [质量回归流程](translation-quality.md)；普通单测不连接模型。

## 校验与浏览器测试

```sh
pnpm check           # ESLint + TypeScript + Vitest
pnpm build
pnpm build:firefox
pnpm exec playwright install chromium firefox
pnpm test:e2e
```

E2E 使用本地 HTTP 模型夹具和真实扩展后台，不模拟 `runtime.sendMessage`，也不让内容脚本请求模型。页面夹具的 CSP 禁止页面网络请求。验证 2000 段页面在第二段响应被暂停时已经显示第一段、快速跳页尾取消旧流、关闭恢复原文，以及悬浮球切换、拖动不误触、窄屏边界、隐藏与恢复、语义 batching、视口延迟翻译、SPA 增量变化、恢复原文、缓存、词卡结构、CSS 隔离、明暗主题、窄屏位置和设置错误。

Chromium 用 Playwright 持久上下文加载生产构建。Firefox 用 Playwright 的 Firefox BiDi 和 Mozilla `web-ext` RDP 临时安装生产构建；由于 BiDi 不暴露扩展页面的执行上下文，测试副本附加打开设置页与 DOM 操作桥接脚本，操作实际设置页并经真实 runtime messaging 访问 background；发布构建不包含这些脚本。网页交互和断言仍由 Playwright 驱动。Firefox 设置页不生成截图。PDF 阅读器尝试由测试副本调用扩展截图 API；当前本机 Firefox 扩展测试环境未提供该 API，因此明确输出 unavailable 说明，不生成冒充截图的文件。其 DOM、几何和画布像素断言仍完整运行；测试桥不进入发布构建。macOS 优先检测 Firefox Developer Edition，也可指定 `FIREFOX_BINARY`。所有测试均使用独立临时配置，不修改日常浏览器配置。

真实网关测试需要显式配置，可能产生服务用量：

```sh
MODEL_BASE_URL=http://127.0.0.1:3425/v1 \
MODEL_NAME=qoder-plugin/qmodel \
pnpm smoke:live
# 可选 MODEL_API_KEY、FIREFOX_BINARY
```

真实测试还会在 2000 段页面记录首段显示时间及首段出现前的最大 rAF 回调间隔（仅为响应性采样，不是完整性能分析），验证滚到页尾继续翻译，再验证中文译文、IPA 按钮、上下文释义与双语例句，并在 `artifacts/live` 保存截图。普通 E2E 截图与 HTML 报告位于 `test-results`、`playwright-report`。

## 网页体验回归

布局用例统一位于 `tests/e2e/`，固定返回较长中文，避免短译文掩盖裁切和叠压。`layout-design.spec.ts` 覆盖产品页大标题、控件、固定高度、flex、窗口缩窄后恢复，以及宿主在翻译期间更新样式；`diverse-layout.spec.ts` 覆盖技术文档、表格、资讯网格、长文图注、折叠内容、SPA 和内部滚动面板。`interaction-design.spec.ts` 覆盖词卡避让、重排、内部滚动、菜单事件与键盘焦点。所有场景在 Chromium 和 Firefox 上运行，断言几何边界、交互和关闭后的恢复，截图辅助设计复核。

线上页面用于补充人工浏览，不能作为 CI 的唯一依赖。发现问题后应在这些受控夹具中建立稳定回归；实测范围和未覆盖边界记录在 [体验报告](../design/2026-10-05-diverse-web-ux.md)。

## 组件、HTTP 与 PDF 回归

- `component-design.spec.ts`：页眉导航、面包屑、按钮、标签页、折叠摘要、静态表单标签、表格操作、菜单、固定控件和模态对话框；检查布局边界、原有点击行为、提示层和恢复。
- `http-context.spec.ts`：普通 HTTP 页面缺少 `crypto.randomUUID` 时，全文、组件提示和划词卡仍能使用；内容脚本不得直接请求模型。
- `performance.spec.ts`：24 个导航项与 2000 张正文卡片共存，首屏正文不被组件挤到队尾，只请求访问视口附近的内容，跳到页尾后继续翻译并完整恢复。测量结果作为 `component-performance.json` 附件保存，记录首段显示、跳转起点及全过程帧间隔，浏览器支持时附带 Long Tasks。属于受控前端体验测量，不是模型 TPS；帧间隔不是对某个函数耗时的归因。
- `pdf.spec.ts`：原创 20 页 PDF，验证网络链接、本地文件、显式开启翻译、切页取消、无文字页提示、窄屏、关闭释放、错误恢复和慢下载取消。PDF.js、worker、provider 和 background 均使用生产实现；Firefox 测试副本的 DOM 操作桥不会进入发布包。

- `pdf-layout.spec.ts`：虚构观测报告的同版式回填，验证彩底、装饰图形、后绘表格线、数字与邮箱区域的像素保留；检查长译文详情、原稿恢复、共享缩放、模式切换、窄屏和不安全页面降级。实际可见覆盖层和画布像素均参与断言，不以隐藏段落列表冒充显示成功。

PDF 夹具在 `pdf-fixture.ts`、`pdf-layout-fixture.ts` 中生成，不含第三方或私人文档。纯函数测试覆盖提取行段、分批边界、URL 校验、大小限制、无长度响应和取消。浏览器内存只对画布像素和活动页数作明确断言，不将它们冒充进程总内存指标。

`pnpm smoke:pdf` 额外读取 Mozilla PDF.js 的公开多栏论文样例，在两种浏览器验证真实 PDF 的字形解析、原稿、逐段回传和 390px 布局；场景维护在 `tests/online/pdf.spec.ts`。模型响应仍是可控夹具，不评价译文准确性。此命令依赖外网，不进入普通 CI；结果位于 `artifacts/public-pdf-review`。

## 本地助手与真实模型启停回归

Apple Silicon Mac（macOS 26.2+）使用 `pnpm model:install` 安装 mlx-serve 后运行：

```sh
pnpm model:bridge
pnpm test:native
```

此测试真实控制当前用户的 MLX 服务，会暂时关闭登录自启、停止/启动模型，请避免同时进行其他模型推理。测试在 Chrome 与 Firefox 中操作真实设置按钮，再从停止状态点击网页翻译，断言中文译文出现。结束时恢复原来的登录自启偏好，保留模型运行。截图与启动耗时保存在 `artifacts/native/`。若强制中断测试，可用 `pnpm model:start` 恢复服务和自启。

普通 CI 不运行此硬件测试；Vitest 覆盖消息校验、扩展白名单、停止保留自启、并发启动合并、取消等待与其他模型隔离。
