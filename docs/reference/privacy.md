# 数据与权限

## 数据与权限

HTTP(S) host permissions 用于网页注入和用户自行配置的模型地址（包括 localhost）。仅 background 发出模型请求，不把 API Key 通过消息传给内容脚本。Key 存储于本机扩展存储，不加密、不云同步；译文与词卡存储于本地 IndexedDB。选区/语义块以及词卡所需的附近上下文会发送到所配置的服务，不包含整个页面 HTML、URL 或页面 Cookie。没有遥测。Firefox manifest 声明 `websiteContent` 传输类别。

实现参考：[WXT 浏览器目标](https://wxt.dev/guide/essentials/target-different-browsers)、[Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)、[Firefox 数据传输声明](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)。
