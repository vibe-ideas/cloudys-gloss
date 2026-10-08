# 四下空格翻译输入框

在网页输入框写好中文后，连续短按四下空格：插件会把**当前输入框全部文字**翻译成英文并替换，不会自动发送或提交表单。相邻按键间隔不超过 650 毫秒；触发用的空格会移除，原有空格保留。默认开启，可在插件设置的「输入框快捷翻译」中关闭，保存后已打开的网页立即生效。

等待时右下角显示状态和「取消」。按 Esc、继续输入、切换输入框或离开页面都会取消，旧译文不会覆盖新草稿。失败时显示原因并保留原文，重新连按四下空格即可重试。成功提示提供 10 秒的「撤销」，普通浏览器编辑器也支持 Ctrl / Cmd + Z；后续编辑遵循网页自身的撤销历史。

## 支持范围

- 普通文本 / 搜索输入框、多行 textarea、常见纯文字 contenteditable，以及开放 Shadow DOM 中的原生输入框。
- 多行草稿保持换行；富文本译文采用编辑器的当前格式，不保证逐词保留原有加粗、链接等格式。原生撤销可恢复原文格式。
- 中文输入法选词、长按空格、密码、验证码、支付卡字段、只读框、常见代码编辑器不触发。
- 含图片、不可编辑卡片等复杂富文本会提示不支持整框替换，避免移除附件。封闭 Shadow DOM、嵌入 iframe、浏览器内部页面暂未覆盖；自定义编辑器可能拦截替换。
- 单次最多 12,000 字符。模型返回无效结构、丢失换行或达到输出上限时拒绝写入；输入框长度限制同样生效。

## 模型与性能

沿用设置中的 MLX、Ollama 或 OpenAI-compatible API，通过独立的英文翻译提示词调用。请求仍全部由 background 发出，并进入共享队列的交互优先级；不抢断正在执行的请求。草稿和英文译文不写入持久缓存。只有用户按键时读取当前编辑器，不扫描整个网页；仅翻译期间观察当前富文本的变更。

2026-10-09 本机 MLX `Qwen/Qwen3-1.7B-MLX-4bit`、temperature 0，以现有常驻服务逐例运行 7 个公开草稿，未使用插件结果缓存；单例端到端耗时约 0.28–2.31 秒。测试未清除模型服务的内部缓存，也不是冷启动或统计性能基准。普通请求、否定含义、条件分支、数字单位、换行、英文原句和草稿内指令的自动检查全部通过；逐例审阅未发现核心含义丢失，个别措辞仍稍生硬。**7 个样例通过不代表通用翻译准确率。**

初次实测曾发现小模型合并换行、执行草稿内指令；已增加翻译示例及换行校验。模型语义错误仍有可能发生，请在发送前检查英文。

## 回归测试

- [输入交互单测](../../tests/unit/input-translation.test.ts)：防误触、取消、迟到结果、失败保留原文和表单同步。
- [Chrome / Firefox E2E](../../tests/e2e/settings/input-translation.spec.ts)：真实扩展消息链路、原生撤销、富文本、Shadow DOM、失败重试和设置开关。
- [固定质量语料](../../tests/quality/input-translation-cases.json)与[本机实际输出](../../tests/quality/baselines/2026-10-09-input-translation/input-translation.json)：包含逐例耗时、语料和 provider 哈希。词面检查不等于语义评分。

```sh
pnpm check
pnpm build
pnpm build:firefox
pnpm exec playwright test tests/e2e/settings/input-translation.spec.ts
QUALITY_TASK=input MODEL_BASE_URL=http://127.0.0.1:8080/v1 \
  MODEL_NAME=Qwen/Qwen3-1.7B-MLX-4bit \
  QUALITY_OUTPUT=artifacts/input-quality-new pnpm test:quality
```

真实模型测试要求输出目录未含同名结果，避免覆盖历史证据。替换模型时用同一语料重新运行并审阅全部译文。
