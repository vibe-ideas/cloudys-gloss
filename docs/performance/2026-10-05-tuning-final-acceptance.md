# 固定语料翻译质量对比

本次验收未通过。要求：用例通过率至少 90%、无严重错误、每例至少两轮；实际 9/12（75.0%）用例两轮均合格，严重错误 0 例。命令以退出码 1 结束，未降低门槛。

数据集：模型及提示冻结后的首次独立验收集。原始结果、评分、语料和生产管线快照见 [归档](../../tests/quality/baselines/2026-10-05-tuning/final-acceptance)；[门槛执行记录](../../tests/quality/baselines/2026-10-05-tuning/final-acceptance/gate.json) 保存完整命令与失败原因。

自动检查不等于语义质量。评分来自署名逐例审阅，非独立盲评；同一输出的重复请求复用评分。

| 模型 | 自动检查 | 已审阅请求 | 全部轮次可接受的用例 | 严重错误用例 |
| --- | ---: | ---: | ---: | ---: |
| Qwen/Qwen3-1.7B-MLX-4bit | 20/24 | 24/24 | 9/12 | 0 |

## A01 · 随身行李重量上限和额外收费适用对象不得混淆

原文：

> Each passenger may carry one bag weighing no more than 7.5 kg. An additional bag costs SGD 24.80; the fee does not increase the weight limit for either bag.

参考译文（允许同义表达）：

每名乘客可携带一件重量不超过 7.5 千克的行李。增加一件行李需支付 24.80 新加坡元；付费不会提高任何一件行李的重量上限。

审阅要点：

- 7.5 千克是单件上限，可携带一件；24.80 新加坡元用于多带一件行李，不是购买超重额度。
- 额外付费不提高任何一件行李的限重，不能译成付费后可超重。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1

每位乘客可携带一个不超过7.5公斤的行李。额外行李费用为SGD 24.80；费用不增加任何行李的重量限制。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。每人一件、不超过 7.5 公斤、额外行李 24.80 SGD 和付费不增加单件限重均保留；两轮币种前后位置不同均合理。“一个…行李”量词略生硬。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 2

每位乘客可携带一个不超过7.5公斤的行李。额外行李费用为24.80 SGD，该费用不增加任何行李的重量限制。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。每人一件、不超过 7.5 公斤、额外行李 24.80 SGD 和付费不增加单件限重均保留；两轮币种前后位置不同均合理。“一个…行李”量词略生硬。

## A02 · 撤离后重新进入建筑必须等待授权而非仅等警报停止

原文：

> You must not re-enter the building until the fire officer gives permission, even if the alarm has stopped. Do not assume that silence means the inspection is complete.

参考译文（允许同义表达）：

即使警报已经停止，在消防负责人允许之前也不得重新进入建筑。不要以为没有警报声就表示检查已经完成。

审阅要点：

- 禁止重新进入持续到消防负责人授权；警报停止不能替代授权。
- 没有警报声不等于检查完成，必须保留否定推断，不能改成检查必然结束。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

你必须在消防员允许之前不得重新进入大楼，即使警报已经停止。不要假设安静意味着检查已经完成。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 2/4 · 严重错误 无。消防人员许可前不得进入、警报停止也不能替代许可及安静不证明检查完成均准确；“你必须在…之前不得…”叠用情态词较生硬，但禁止与例外关系清楚。

## A03 · 烘焙步骤中先冷却再装盒且取货发生在次日

原文：

> After the loaves had cooled completely, the baker packed them into boxes. The courier collected the boxes the following morning, not on the day they were baked.

参考译文（允许同义表达）：

面包完全冷却后，面包师才把它们装进盒子。快递员在第二天早上取走这些盒子，而不是烘焙当天。

审阅要点：

- 完全冷却在前、装盒在后；不能把装盒后冷却当成原文顺序。
- 取货时间是烘焙次日早晨，不是当天，也不是送到收件人的时间。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

当面包完全冷却后，面包师将它们装进箱子里。快递员第二天早晨收集这些箱子，而不是在它们被烘焙的那天。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。完全冷却之后装盒、次日早晨取货而非烘焙当天均正确；“收集这些箱子”有翻译腔，最后“它们被烘焙”指代不够自然但按场景可理解为面包。

## A04 · 并非所有海滩关闭不能译为全部开放或全部关闭

原文：

> Not all beaches on the island are closed. The northern beach is open to walkers, but swimming there is still prohibited.

参考译文（允许同义表达）：

岛上的海滩并非全部关闭。北部海滩允许人们散步，但仍禁止在那里游泳。

审阅要点：

- 并非全部关闭不等于全部开放；不能扩大为每处海滩都可进入。
- 北部海滩可散步但不可游泳，地点和两类活动的许可必须区分。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

并非所有岛上的海滩都关闭。北部的海滩对步行者开放，但在那里游泳仍被禁止。

自动检查：通过

审阅：忠实度 4/4 · 完整性 4/4 · 自然度 3/4 · 严重错误 无。并非全部海滩关闭的否定范围、北部允许散步而仍禁止游泳均准确；语序和“步行者”稍有翻译腔。

## A05 · draft 在门缝冷风与编辑稿件两段中应采用不同词义

原文：

> A cold draft came through the gap under the door, so I placed a rolled towel against it.

> On my desk lay the first draft of a letter that I had not yet sent.

参考译文（允许同义表达）：

一股冷风从门下的缝隙吹进来，于是我用卷起的毛巾堵住了缝隙。

桌上放着一封信的初稿，我还没有把信寄出去。

审阅要点：

- 第一段 draft 为冷风，毛巾用于挡住门缝，不能把它译成草稿。
- 第二段 draft 为信件初稿；信尚未寄出，不能混成窗边气流或已寄出的信。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

一阵冷风穿过门缝，我于是把一张卷起的毛巾放在了那里。

我桌上的第一稿信件尚未送出。

自动检查：通过
- A05-3: 书桌处应出现稿件语义

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 2/4 · 严重错误 无。两个 draft 分别译成冷风和“第一稿信件”，后者虽未命中草稿/初稿正则，语义合理，并非漏译；信尚未寄出也保留。第一段未明确门下方、毛巾用于抵住缝隙被概括为放在那里，“一张…毛巾”量词不当。

## A06 · 接力赛中的 final leg 指最后一棒而非身体受伤

原文：

> Amir ran the final leg of the relay and overtook two teams before the finish. He was exhausted but had not injured his leg.

参考译文（允许同义表达）：

阿米尔跑接力赛的最后一棒，并在终点前超过了两支队伍。他筋疲力尽，但腿没有受伤。

审阅要点：

- final leg 为接力赛最后一棒或最后一段，不是最后一条腿。
- 超过两队发生在到终点前；人虽疲惫但腿未受伤，不能反转否定。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

Amir完成了接力赛的最后一段，并在终点前超过了两支队伍。他感到疲惫，但没有受伤。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 4/4 · 严重错误 无。final leg 正确为接力最后一段，终点前超过两队准确；exhausted 被弱化为疲惫，未伤到腿概括为没有受伤，损失部位限定但未反转否定。

## A07 · 产品选择中的 on the fence 表示犹豫而非坐在围栏上

原文：

> I am still on the fence about buying the camera. The image quality is excellent, but replacing the battery would cost almost as much as a used body.

参考译文（允许同义表达）：

我还在犹豫要不要买这台相机。画质确实出色，但更换电池的费用几乎赶得上一台二手机身。

审阅要点：

- on the fence 是尚未决定、犹豫，并非坐在栅栏上。
- 画质是优点；换电池成本几乎等于二手机身，不是电池续航接近或必然比机身贵。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

我还在犹豫是否购买相机。图像质量很好，但更换电池的成本几乎和用旧机身一样。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 2/4 · 严重错误 无。犹豫、画质好、换电池费用几乎等于旧机身这条主要成本比较仍可理解；“和用旧机身一样”把二手机身说得含混且价格比较对象省略较重，有明显翻译腔，尚未改成续航或断言电池更贵。

## A08 · 付费景观房面对砖墙时的称赞应保留抱怨语气

原文：

> What a spectacular view! We paid extra for a room whose only window faces a brick wall. Money well spent, obviously.

参考译文（允许同义表达）：

这景色可真壮观！我们多花了钱住进这间房，唯一的窗户却对着一堵砖墙。显然，这钱花得可真“值”。

审阅要点：

- 额外付费、房间唯一窗户和砖墙必须保留，不能凭空出现真实美景。
- 开头和结尾为反讽抱怨，允许中文通过语气或事实反差表达，不要求固定引号或措辞。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

多么壮观的景色！我们为一间窗户朝向砖墙的房间多付了钱。显然这笔钱花得值得。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 3/4 · 严重错误 无。付额外费用却面对砖墙与首尾称赞形成反讽，未凭空描写真实美景；遗漏 only 的唯一窗户限定，挖苦语气偏直译，但主要抱怨仍可识别。

## A09 · 档案数字化长文保留文物保护、开放限制和下一阶段条件

原文：

> The county archive began digitizing letters donated by local families. Staff photographed each page under soft lighting and stored the originals in acid-free folders. They recorded uncertain names exactly as written instead of silently correcting them. Volunteers could help transcribe the images, but only trained staff were allowed to handle the fragile originals. The first stage covered material from 1920 to 1945 and took nine months.
>
> The online collection is free to browse, although some letters remain private at the donors&#x27; request. The archive has not destroyed the paper originals and does not plan to sell them. A second stage will include diaries, provided that enough funding is secured. Until then, visitors can consult a printed catalogue in the reading room by appointment.

参考译文（允许同义表达）：

县档案馆开始对当地家庭捐赠的信件进行数字化。工作人员在柔和光线下拍摄每一页，并将原件存放在无酸文件夹中。对于无法确定的姓名，他们按原文记录，不会擅自更正。志愿者可以协助转录图像，但只有受过培训的工作人员才可接触脆弱的原件。第一阶段处理了 1920 年至 1945 年的材料，历时九个月。

网上馆藏可免费浏览，不过应捐赠者要求，部分信件仍不公开。档案馆没有销毁纸质原件，也不打算出售它们。如果获得足够资金，第二阶段将纳入日记。在此之前，访客可以预约到阅览室查阅纸质目录。

审阅要点：

- 完整保留拍摄光线、无酸保存、疑似姓名照录不擅改、志愿者可转录但仅培训员工可接触原件、1920–1945 年范围与九个月工期。
- 不能漏掉第二段；免费浏览不等于全部信件公开；隐私限制来自捐赠者要求。
- 原件未销毁且无出售计划；纳入日记须资金足够，纸质目录可在预约后于阅览室查阅。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

县档案馆开始对当地家庭捐赠的信件进行数字化。工作人员在柔和的灯光下拍摄每页，并将原件存入防酸的文件夹中。他们以不确定的姓名精确地记录下来，而不是随意更正。志愿者可以协助转录图像，但只有经过培训的工作人员才能处理脆弱的原件。第一阶段涵盖了1920年至1945年的材料，耗时九个月。

在线收藏免费浏览，但一些信件在捐赠者请求下仍保持隐私。档案馆并未销毁纸质原件，也不计划出售它们。第二阶段将包括日记，前提是能够获得足够的资金。在此之前，访客可以预约时间在阅览室查阅印刷的目录。

自动检查：通过

审阅：忠实度 2/4 · 完整性 3/4 · 自然度 2/4 · 严重错误 无。两段、1920–1945、九个月、培训人员限制、部分信件保密、未销毁/不出售、资金条件和预约目录等保留。但 acid-free folders 是无酸文件夹，译成防酸文件夹，把不含酸材质变成抵御酸性物质，改变文物保存要求。“以不确定的姓名精确地记录下来”也未清楚表达按原文照录，文字生硬。

## A10 · 命令行试运行标志和输出路径应原样保留且不误称已改文件

原文：

> Run atlas sync --dry-run before making changes to /var/data/catalog.json. The --dry-run flag prints the proposed actions without writing the file; removing it enables the actual update.

参考译文（允许同义表达）：

在修改 /var/data/catalog.json 之前，先运行 atlas sync --dry-run。--dry-run 标志会打印计划执行的操作而不写入文件；移除该标志后才会实际更新。

审阅要点：

- 完整保留命令、--dry-run 标志及文件路径；试运行先于正式更改。
- 带标志仅显示计划、不写文件；移除标志才实际更新，不能把两者行为颠倒。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

运行 atlas 同步 --dry-run 在对 /var/data/catalog.json 进行修改前。--dry-run 标志会打印出拟进行的操作而不写入文件；去掉它则启用实际更新。

自动检查：失败
- A10-1: 完整试运行命令

审阅：忠实度 2/4 · 完整性 4/4 · 自然度 2/4 · 严重错误 无。原命令 atlas sync --dry-run 被译成 atlas 同步 --dry-run，sync 是必须保留的子命令，不是可替换中文的说明词；这是真实代码标识改写，不是空格或格式差异。路径、试运行不写入、移除标志才正式更新及先后关系均保留，但给出的命令不可原样执行。

## A11 · 自愿问卷的少数样本发现不能推广为全体居民结论

原文：

> Only 18 of the 240 residents invited to the survey responded. Most respondents preferred evening classes, but the authors warned that these volunteers might not represent the wider community.

参考译文（允许同义表达）：

受邀参加调查的 240 名居民中，只有 18 人作答。大多数答卷者偏好晚间课程，但作者提醒，这些自愿参与者可能无法代表更广泛的社区居民。

审阅要点：

- 受邀者 240 人、实际作答 18 人，两类人群不能交换；大多数仅修饰作答者。
- 对自愿样本代表性的警告和可能性应保留，不能断言全体居民偏好夜课或样本一定没有代表性。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

仅18名受邀居民参加了调查。大多数受访者更喜欢晚间课程，但作者警告说，这些志愿者可能并不代表整个社区。

自动检查：失败
- A11-1: 受邀人数 240

审阅：忠实度 3/4 · 完整性 2/4 · 自然度 4/4 · 严重错误 无。只剩18人作答的信息，原文240名受邀者的总数整项遗漏，无法看到18/240的响应比例；不是中文数字或格式变体。多数答卷者偏好晚间课程与样本可能不具代表性的警告均保留，未捏造新的数字。

## A12 · 失物报告中的发现者、保管者和所有人需要各自对应

原文：

> Ravi found Elena&#x27;s scarf on the train and handed it to the station clerk. Elena did not know it was missing until Ravi called her.

> The clerk kept it at the station overnight. Elena collected it herself the next day and thanked Ravi for reporting it.

参考译文（允许同义表达）：

拉维在火车上发现了埃琳娜的围巾，并把它交给车站工作人员。直到拉维打电话给她，埃琳娜才知道围巾丢了。

工作人员把围巾在车站保管了一夜。第二天，埃琳娜亲自领取了围巾，并感谢拉维报告这件事。

审阅要点：

- 围巾属于 Elena，发现和报告者为 Ravi，暂时保管者为车站工作人员，不能互换人物职责。
- Elena 在电话告知后才发现丢失；围巾过夜存于车站，第二天由 Elena 自己领取，不是 Ravi 代领。

### Qwen/Qwen3-1.7B-MLX-4bit · 轮次 1, 2

Ravi在火车上发现了埃莉娜的围巾，将其交给车站的职员。埃莉娜直到Ravi叫她才知道围巾不见了。

职员将围巾留放在车站一整夜。埃莉娜第二天自己去收集，并感谢Ravi报告此事。

自动检查：通过

审阅：忠实度 3/4 · 完整性 3/4 · 自然度 3/4 · 严重错误 无。失物所有人、发现者、保管者和次日亲自领取的角色均正确；called her 译成“叫她”，没有明确电话告知，“去收集”表达领取稍生硬，主要通知时序与物品流转保留。
