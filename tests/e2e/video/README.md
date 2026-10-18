# YouTube 双语字幕回归

`youtube-fixture.ts` 是自有播放器夹具；E2E 将其路由到 YouTube origin，覆盖生产脚本匹配、WXT 页面桥接、后台模型调用与真实浏览器 Shadow DOM。公开网站烟测与本夹具结果应分开记录。

`timeline.webm` 是自生成的 600 秒纯色无声视频（160×90、1 fps），用真实媒体时钟验证 seek、暂停和全屏，不依赖修改页面 JS getter。无第三方版权素材。可重新生成：

```sh
ffmpeg -f lavfi -i color=c=0x25352d:s=160x90:r=1 -t 600 -an -c:v libvpx -b:v 8k -g 10 timeline.webm
```

执行：

```sh
pnpm build
pnpm build:firefox
pnpm exec playwright test tests/e2e/video/youtube.spec.ts
```

实际 YouTube 验证使用用户授权的视频页，确认按钮提示为“字幕轨道 · 提前翻译”或“当前 CC · 实时翻译”，分别记录；不要把模拟服务耗时当成模型真实吞吐。
