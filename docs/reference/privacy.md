# 数据与权限

## 数据与权限

HTTP(S) host permissions 用于网页注入和用户自行配置的模型地址（包括 localhost）。仅 background 发出模型请求，不把 API Key 通过消息传给内容脚本。Key 存储于本机扩展存储，不加密、不云同步；译文与词卡存储于本地 IndexedDB。选区/语义块以及词卡所需的附近上下文会发送到所配置的服务，不包含整个页面 HTML、URL 或页面 Cookie。没有遥测。Firefox manifest 声明 `websiteContent` 传输类别。

实现参考：[WXT 浏览器目标](https://wxt.dev/guide/essentials/target-different-browsers)、[Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)、[Firefox 数据传输声明](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)。

`nativeMessaging` 权限用于与用户安装的本地 MLX 助手通信。助手仅允许本扩展 ID，接受固定的状态、启停、重启和自启开关操作；不接受任意命令、模型路径或网页内容。手动管理消息只允许扩展页面发出，网页内容脚本不能直接控制服务。自动启动仅用于用户配置的默认本地 MLX。

词卡音标查找使用扩展随包的离线 US / UK 词典，不请求第三方词典服务；释义与例句仍由配置的模型生成。词典来源、许可与覆盖限制见 [离线音标说明](../development/offline-pronunciation.md)。

PDF 阅读器在扩展标签页中解析用户选择的文件，本地文件本身不会上传。在线 PDF 由阅读器直接下载，不携带 Cookie 或 Referer；这是文件下载，不是模型调用。只有用户点击「开启双语」后，当前页提取的文字才通过 background 发送到所配置的模型，结果使用同一本地缓存。PDF 的解析 worker、字体和字符映射均随包提供；无第三方 CDN。使用远程模型时，待翻译文字会传出本机。

输入框快捷翻译默认开启，可在设置关闭。仅连续短按四下空格后，将当前输入框的全部文本通过 background 发送到用户配置的模型服务；不发送输入框 HTML，也不将草稿和英文译文存入 IndexedDB。密码、验证码、支付卡字段和只读输入框不触发。配置远程 API 时，草稿文字会发送到该服务；取消只能中断尚未完成的请求，不能撤回已经发送的文字。
