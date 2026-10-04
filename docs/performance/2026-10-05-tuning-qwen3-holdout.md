# 固定语料翻译质量对比

自动检查不等于语义质量。评分来自署名逐例审阅，非独立盲评；同一输出的重复请求复用评分。

| 模型 | 自动检查 | 已审阅请求 | 全部轮次可接受的用例 | 严重错误用例 |
| --- | ---: | ---: | ---: | ---: |
| Qwen/Qwen3-1.7B-MLX-4bit | 24/24 | 24/24 | 10/12 | 1 |

## H01 · 年费和设备数量保留原值且不能把折后价当作折扣额

原文：

> After the discount, the annual subscription is EUR 68.40 for two devices. The renewal price is not guaranteed to stay the same.

参考译文（允许同义表达）：

折后年费为 68.40 欧元，可供两台设备使用。续订价格不保证保持不变。

审阅要点：

- 68.40 欧元是折后总年费，不是每月价格或优惠金额；可用于两台设备。
- 不能把续订价格可能变化译为保证不变，也不能断言一定涨价。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1

在折扣后，年度订阅费用为68.40欧元，适用于两台设备。续订价格不保证保持不变。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。68.40、欧元（另一轮保留 EUR）、年度、两台设备及续订价格不保证不变均准确；“在折扣后”略有翻译腔。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 2

在折扣后，年度订阅费用为EUR 68.40，适用于两台设备。续订价格不保证保持不变。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。68.40、欧元（另一轮保留 EUR）、年度、两台设备及续订价格不保证不变均准确；“在折扣后”略有翻译腔。

## H02 · 打开检修盖前必须关闭阀门且灯灭不能证明安全

原文：

> Never open the inspection cover unless the valve is fully closed. The indicator going dark does not prove that the pressure has fallen to zero.

参考译文（允许同义表达）：

除非阀门已完全关闭，否则绝不能打开检修盖。指示灯熄灭并不能证明压力已降至零。

审阅要点：

- 打开检修盖的必要条件是阀门完全关闭，不能反转条件或删除禁止。
- 灯灭不能推出压力归零；不能改成灯灭表示安全或阀门打开时才可检修。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

除非阀门完全关闭，否则不要打开检查盖。指示灯变暗并不意味着压力已经降至零。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 4/4 · 严重错误 无。阀门完全关闭才可开盖、灯光状态不能证明压力归零的必要条件和否定保留；going dark 应为熄灭，译为“变暗”存在状态细节偏差，never 的强调也略弱。未反转安全条件。

## H03 · 过去时间点的已发货和至今未送达不能混淆

原文：

> By the time I called on Tuesday, the parcel had already left the warehouse. It still has not reached the customer, who was promised delivery by Friday.

参考译文（允许同义表达）：

我周二打电话时，包裹早已离开仓库。但它至今仍未送到客户手中，而客户原本得到的承诺是最迟周五送达。

审阅要点：

- 周二打电话前就已离仓，不是打电话后才发货。
- 截至叙述时仍未送达；周五是承诺的送达期限，不是已送达日期。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

直到周二我打电话时，包裹已经离开了仓库。它仍然没有到达顾客手中，顾客被承诺在周五送达。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 2/4 · 严重错误 无。周二联系时已经离仓、至今未送达和周五承诺均保留；“直到…时”生硬但后续“已经”仍表明此前离仓。“by Friday”截止含义被弱化成“在周五”，且“顾客被承诺”不自然。

## H04 · 次品率下降时百分点与相对降幅必须区分

原文：

> The share of defective parts fell from 10% to 8%. This is a drop of two percentage points, equivalent to a 20% relative reduction.

参考译文（允许同义表达）：

次品占比从 10% 降至 8%，下降了两个百分点，相当于相对减少 20%。

审阅要点：

- 次品占比下降而非上升；起点终点分别为 10% 和 8%。
- 两个百分点是绝对变化，20% 是相对降幅，不得互换或描述为下降 20 个百分点。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

缺陷品占比从10%降至8%，这是下降了两个百分点，相当于相对减少20%。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。10% 到 8% 的下降方向、两个百分点绝对变化与 20% 相对降幅均准确；“这是下降了”稍生硬。

## H05 · 电池语境中的 charge 表达电量而不是收费或起诉

原文：

> The battery can hold a charge for a week, but cold weather drains it faster. Leave the spare battery indoors until you need it.

参考译文（允许同义表达）：

这块电池充满电后能维持一周，但寒冷天气会让它耗电更快。备用电池在使用前应放在室内。

审阅要点：

- charge 在这里是储存的电量，不是收费、指控或冲锋。
- 一周续航和低温加快耗电均需保留；备用电池先放室内，不是使用完才拿进去。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

电池可以维持一周的电量，但寒冷的天气会更快地耗尽电量。请将备用电池存放在室内，直到需要使用的时候。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。charge 为电量，一周、寒冷加速耗电及备用电池使用前留室内均保留；“维持一周的电量”略有翻译腔但可理解。

## H06 · 野营语境中 pitch a tent 表达搭帐篷并保留空间限制

原文：

> We pitched our tent below the ridge to stay out of the wind, leaving enough space between the fabric and the stove.

参考译文（允许同义表达）：

为避风，我们在山脊下方搭起帐篷，并在帐篷布与炉子之间留出足够的距离。

审阅要点：

- pitch 是搭建帐篷，不是投掷或推销；地点在山脊下方而非顶部。
- 避风目的和帐篷布与炉子保持距离的关系均需保留。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

我们把帐篷搭建在山脊下方，以便避开风，确保帐篷与炉灶之间有足够的空间。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 4/4 · 严重错误 无。正确表达在山脊下方搭帐篷以避风，以及与炉灶保持距离；fabric 被概括为帐篷，布料这一具体对象略弱化，不改变主要动作或空间关系。

## H07 · 合同语境中的 the ball is in your court 表示下一步由对方决定

原文：

> We have sent you the revised contract, so the ball is now in your court. Let us know by Monday whether you want to proceed.

参考译文（允许同义表达）：

修改后的合同已发给你，接下来就看你的决定了。请在周一之前告诉我们是否继续推进。

审阅要点：

- 习语指接下来由收件方回应或决定，不能理解为体育场上的球。
- 合同已经发出；需在周一前反馈是否继续，而非周一再发合同或默认同意。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

我们已发送您修订后的合同，现在轮到您了。请于本周一告知是否继续。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 2/4 · 严重错误 无。修订合同已发出、“轮到您了”表达下一步由对方回应，是否继续也保留；“已发送您”缺少介词，by Monday 的截止意味被弱化为“于本周一”，且原文未明确本周。

## H08 · 打印机故障后的赞叹语应传达反讽而不是肯定节纸

原文：

> Wonderful—the printer has produced 200 blank pages again. What a brilliant way to save paper.

参考译文（允许同义表达）：

真行，打印机又吐出了 200 张白纸。这可真是个“节约纸张”的好办法。

审阅要点：

- again 表示再次故障，200 张白纸不可改成成功打印的有内容页面。
- 两句为抱怨和反讽，不能当成真心赞扬打印机节纸；允许多种中文反讽表达。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

这真是了不起，打印机又生产了200张空白页。多么巧妙的方式节省纸张。

自动检查：通过

审阅：忠实度 3/4 · 完整性 4/4 · 自然度 2/4 · 严重错误 无。再次输出 200 张空白页及对节纸的夸赞并置，读者仍可从荒谬反差识别反讽；“生产…空白页”“多么巧妙的方式节省纸张”生硬，未另外出现实际节纸成功的结论。不因未加引号而判为失败。

## H09 · 同一块内的湿地长文保留前后段结论和不同地点的限制

原文：

> A town restored a small wetland beside its primary school. Volunteers removed litter, planted native reeds, and built a raised path so that children could watch birds without stepping on fragile plants. The work took eight months, and the path remained closed during the breeding season. Teachers used the site for lessons but did not allow pupils to collect eggs or disturb nests.
>
> During the following winter, nearby gardens flooded less often than before. However, that winter also had less rainfall, so the council could not attribute the improvement entirely to the restoration. It plans to monitor both rainfall and water levels for another three years before deciding whether to repeat the project elsewhere.

参考译文（允许同义表达）：

一个小镇修复了小学旁的一片小湿地。志愿者清理垃圾、种植本地芦苇，并修建了架高的步道，让孩子们可以观鸟而不踩踏脆弱的植物。工程历时八个月，步道在繁殖季节关闭。老师会在这里授课，但不允许学生捡鸟蛋或惊扰鸟巢。

接下来的冬天，附近花园的积水次数比以往减少了。不过，那个冬天的降雨也较少，因此镇议会不能把改善完全归因于湿地修复。议会计划继续监测降雨和水位三年，再决定是否在其他地方开展同类项目。

审阅要点：

- 前段完整保留位置、清理垃圾/本地芦苇/架高步道三项工作、观鸟并保护植物的目的、八个月工期、繁殖季关闭以及不能捡蛋扰巢。
- 不能漏译块内第二段；保留随后冬季积水减少、降雨同样减少、因果归属不确定、继续监测降雨与水位三年、再决定推广。
- 不能宣称湿地修复必然防洪成功或已决定推广。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

一个城镇在它主要小学旁边恢复了一个小型湿地。志愿者们清理了垃圾，种植了原生的芦苇，并建造了一条抬高的路径，以便孩子们可以观察鸟类而不踩到脆弱的植物。这项工作持续了八个月，而路径在繁殖季节期间仍然关闭。教师们利用这个地点进行教学，但不允许学生收集蛋或打扰鸟巢。

在接下来的冬天，附近花园比之前更少地被淹。然而，那个冬天也降雨较少，因此市政委员会无法将改善归因于该恢复工作。他们计划在未来三年内继续监测降雨量和水位，以便决定是否在其他地方重复该项目。

自动检查：通过

审阅：忠实度 2/4 · 完整性 3/4 · 自然度 2/4 · 严重错误 无。前后两段、八个月、繁殖季关闭、教学限制、雨量减少和继续监测三年均保留；但 cannot attribute ... entirely 被译为“无法将改善归因于该恢复工作”，漏掉“完全”，把不能全归因改成不能归因，改变因果归属的限定。“主要小学”“抬高的路径”“更少地被淹”也有明显翻译腔。

## H10 · HTTP 重试规则保留状态码条件和请求标识符

原文：

> For GET /v2/jobs, retry only after an HTTP 429 response and wait at least 15 seconds. A 404 response means the job was not found; keep the X-Request-ID header when reporting the problem.

参考译文（允许同义表达）：

对 GET /v2/jobs 请求，只能在收到 HTTP 429 响应后重试，且至少等待 15 秒。404 响应表示未找到该任务；报告问题时请保留 X-Request-ID 请求头。

审阅要点：

- 重试仅限 429，最少等待 15 秒；不能改成最多等待或让 404 同样重试。
- 404 表示任务未找到；GET、路径、状态码和 X-Request-ID 名称必须保留。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

对于GET /v2/jobs的请求，仅在收到HTTP 429响应后重新尝试，并等待至少15秒。404响应表示该作业未找到；在报告问题时，保持X-Request-ID头。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。GET /v2/jobs、429 才重试、至少 15 秒、404 未找到、X-Request-ID 均保留；“保持…头”略生硬但仍可识别请求头保留要求。

## H11 · 观察性研究的相关性不能夸大为因果或保证

原文：

> People who reported longer sleep tended to score higher on the memory test. Because the study was observational, it cannot show that sleeping longer caused the higher scores, and the findings may not apply to children.

参考译文（允许同义表达）：

自述睡眠时间较长的人，记忆测试得分往往较高。由于这是一项观察性研究，它不能证明更长的睡眠导致了更高的分数，而且研究结果未必适用于儿童。

审阅要点：

- 睡眠时间来自自述，得分更高是倾向而非人人如此。
- 观察性研究不能证明因果，不得声称多睡一定提高记忆力；结果对儿童适用性不确定，不是已经证明无效。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

报告睡眠时间较长的人在记忆测试中得分较高。由于这项研究是观察性的，因此不能证明睡眠时间更长导致了更高的分数，而且这些结果可能不适用于儿童。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 3/4 · 严重错误 无。自述较长睡眠与测试得分、观察研究不能证明因果及可能不适用于儿童均保留；tended to 的倾向限定未明确译出，中文读作群体得分比较，尚未直接断言人人如此或建立因果。

## H12 · 两段工作交接中的责任主体和先后顺序不应颠倒

原文：

> Noah sent Ada the draft after checking the figures. Ada noticed a missing heading and asked Noah to add it before the document went to the client.

> He made the change that evening, but she did not approve the final version until the next afternoon.

参考译文（允许同义表达）：

诺亚核对数字后将草稿发给了艾达。艾达发现少了一个标题，便请诺亚在把文档发给客户之前补上。

诺亚当晚做了修改，但艾达直到第二天下午才批准最终版本。

审阅要点：

- 核对数字、发草稿和补标题的人为 Noah；发现遗漏、要求修改及最后批准的人为 Ada，不能交换。
- 先核对再发草稿，先补标题再交客户；当晚修改，直到次日下午才获批准。
- 第二段 he/she 指代承接第一段，不能凭空加入客户本人批准。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

Noah 发送了草稿给 Ada，之后检查了数字。Ada 发现了标题缺失，并在文件发送给客户之前要求 Noah 添加它。

他当晚做出了更改，但她直到第二天下午才批准了最终版本。

自动检查：通过

审阅：忠实度 1/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 有。原文 Noah 在核对数字后发送草稿，译文明确说“发送了草稿…之后检查了数字”，把先核对后发送反转成先发送后核对，属于既有标准中的执行顺序严重错误。其余发现标题、要求补充、当晚修改与次日下午批准基本保留。
