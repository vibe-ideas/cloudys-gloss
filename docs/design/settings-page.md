# 独立标签页设置

2026-10-15。Chrome 原先把设置页嵌在扩展管理弹窗中，长表单、词库和本地模型管理不适合该容器。

在 Options HTML 入口声明 `manifest.open_in_tab=true`，由 WXT 为 Chrome / Firefox 生成配置。继续使用 `runtime.openOptionsPage()`，交给浏览器打开或复用设置页。无需额外 tabs 权限。[WXT Options 配置](https://wxt.dev/guide/essentials/entrypoints#options)

桌面采用分区导航与表单两栏布局；窄窗口导航换行放在顶部。分区使用原生锚点，可通过键盘跳转和聚焦；测试连接与保存操作固定在视口底部。表单保存方式不变。

## 回归用例

[设置页测试](../../tests/e2e/settings/settings-design.spec.ts)：

- 从工具栏打开设置时使用独立标签页，再次打开复用该页并保留未保存草稿。
- 设置页在桌面和窄窗口中可按分区导航，表单与保存按钮不横向溢出。
- 原有预设选择、保存、重新打开，以及 PDF 入口测试保持通过。

[阅读测试](../../tests/e2e/reading/extension.spec.ts) 验证 Chrome / Firefox 的网页悬浮球设置入口。Chromium 使用 `tabs.getCurrent().active` 确认当前设置页被激活；不依赖无 tabs 权限时会被浏览器隐藏的 tab URL。

本地 lint、typecheck、382 项单测通过；两份 E2E 文件共 20 项通过，4 项 Firefox 设置 DOM 用例按现有驱动限制跳过。首次全量单测有两项翻译生命周期用例失败，单文件及全量复跑通过；Firefox 首次启动失败，相关用例复跑通过。Chrome / Firefox 构建均确认 `open_in_tab=true`，桌面与窄窗口截图已检查。

## 本地使用

已加载 `.output/chrome-mv3` 的 Chrome，在 `chrome://extensions` 点击扩展的重新加载，再打开设置即可。重新加载前先保存已有草稿。
