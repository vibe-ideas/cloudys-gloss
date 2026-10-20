# 单词卡发音

点击词卡里的 US / UK 按钮播放美式或英式读音。发音文字是词条本身，IPA 仍由词卡数据提供；发音不调用 LLM。

## Firefox + macOS

Firefox 在部分 macOS 版本上通过 Web Speech 播放时，会在结尾产生爆音。相关上游记录：[Mozilla 2073831](https://bugzilla.mozilla.org/show_bug.cgi?id=2073831)、[Mozilla 2057741 的调查](https://bugzilla.mozilla.org/show_bug.cgi?id=2057741#c8)。本扩展绕开这条播放路径：

1. 内容脚本请求扩展后台。
2. 后台通过 Native Messaging 调用本地助手，用 macOS `say` 生成 PCM WAV。
3. 后台使用普通音频播放器播放 WAV，不调用 Web Speech。

优先使用系统已安装的女声：美式 Samantha，英式 Serena / Kate / Martha，其次 Flo / Shelley / Sandy；按口音匹配完整系统名称，不混用美式和英式。当前本机使用 Samantha（美式）与 Flo（英式），全部在本机运行。网页的媒体 CSP 不影响后台播放。助手不会为发音启动 MLX，也不会把单词发往远端语音服务。

在项目目录安装或更新助手，然后重新载入扩展、刷新网页：

```sh
pnpm model:bridge
```

此步骤需要 macOS 和 Python 3，不需要先安装模型。已有 MLX 环境时复用其 Python，否则使用运行安装脚本的 Python。助手缺失、语音未安装或播放失败时，卡片会显示错误，不自动退回有爆音风险的 Web Speech。

关闭卡片会停止播放；连续点击或切换口音会取消上一次播放。正在系统中生成的音频可能等到生成结束才释放，但取消后的结果不会播放。系统生成串行执行，超时为 15 秒；播放超时为 20 秒。后台最多缓存 32 条、约 2 MB 的音频数据，仅驻留内存，不长期占用磁盘。

## 其他浏览器和平台

继续使用浏览器 Web Speech，在对应 `en-US` / `en-GB` 口音中优先选已知女声，本地女声优先。Web Speech 没有统一性别字段，依据已知声音名称或 female 标记选择；找不到女声时保留对应口音的可用系统声音。首次语音列表为空时等待 voiceschanged，最多 500 ms，关闭词卡会取消等待。

## 回归验证

```sh
pnpm check
pnpm build:firefox
pnpm exec playwright test -c playwright.speech.config.ts
```

最后一项需要已安装助手的本地 Apple Silicon Mac，使用真实 Firefox Developer Edition、本地系统语音和音频播放；词卡数据由测试服务器提供。覆盖美式、英式和缓存后再次播放，验证正常结束、无错误、没有额外模型请求。

单元测试覆盖系统音频成功或失败时不调用 Web Speech、关闭卡片后忽略迟到结果、切换口音停止旧音频、助手不可用时提示修复，以及发音输入校验。自动化验证播放链路和结束事件，不能代替人耳确认是否仍有可闻杂音。
