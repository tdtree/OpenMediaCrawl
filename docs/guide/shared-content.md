# 共享内容库

多账号、多用户采同一批内容时，平台返回的作品和评论会大量重叠。共享内容库把「内容」保存一份，
把「谁采到过、拿它做了什么」按用户分开：

- 内容（作品、评论、博主、媒体字节）：全站一份，按 `(平台, 作品 id)` / `(平台, 评论 id)` / sha256 唯一。
- 引用（refs）：每个用户一份，记录「因为哪个关键词 / 哪个任务采到过它」。
- 提取（线索、候选池、词库、私信、群发、清理掩码）：仍然留在各用户目录。

## 目录与表

```
<out>/shared/
├── content.sqlite
├── blobs/<aa>/<sha256>.<ext>
├── tmp/                    # 下载中转，任务结束即删
└── config.json             # 复用窗口
```

| 表 | 作用 |
|---|---|
| `items` | 作品正文；`body=full` 表示抓过详情，`summary` 表示只有搜索列表信息 |
| `comments` / `comments_state` | 评论正文；状态记 `lim`（0=一级全量）、`complete`（一级翻完）、`with_replies`（楼中楼采过） |
| `creators` | 博主资料 |
| `item_media` / `blobs` | 作品 → 媒体的有序清单；字节按 sha256 只存一份 |
| `refs` | 用户 × 作品：`first_at` / `last_at` / `job_id` / `keyword` / `account` |
| `claims` | 抓取租约，防两个任务同时请求同一条 |
| `fetch_log` | 每次「真抓 / 复用 / 失败」，用来算省了多少请求 |
| `user_masks` | 清理时「对我隐藏」，不影响别人 |
| `meta` | 内容版本号，UI 缓存失效用 |

## 采集时怎么判定

| 情况 | 行为 |
|---|---|
| 库里没有 | 抓详情（+ 评论 / 媒体，按任务选项） |
| 有 full 且在窗口内 | **不发详情请求**；用搜索结果里的标题/封面/点赞数覆盖库里的统计 |
| 有 full 但过期 | 抓一次详情，更新唯一副本（所有用户共用） |
| 只有 summary | 抓详情 |
| 评论窗口内且条数够、楼中楼也够 | **不发评论请求** |
| 媒体清单齐全且 blob 在 | **不下载** |
| 两个任务同时命中 | 抢 `claims` 租约，抢不到的等对方落库后复用；租约 180 秒，过期可接管 |

窗口默认：作品正文 30 天、评论 24 小时、媒体永久（媒体文件不可变）。改 `<out>/shared/config.json`：

```json
{ "enabled": true, "itemTtlDays": 30, "commentTtlHours": 24, "reuseItems": true, "reuseComments": true, "reuseMedia": true }
```

任务级覆盖：`--refresh auto|always|never`（`always` 强制重抓正文和评论，媒体仍只补缺）。

## 用户能看到什么

- 作品列表 = 该用户的 `refs`；正文/评论从共享库回填。旧的按用户 jsonl 仍然作为兜底，
  所以没导入之前的历史数据照常显示，导入后也不会重复。
- 媒体接口 `GET /api/media?platform=&item=&seq=`：只有「有引用的人」或 admin 能取。
- 采集任务的返回计数带 `reusedItems` / `reusedComments` / `reusedMedia`，任务日志会写一行「复用 …（没有重复请求平台）」。
- `GET /api/content/stats`（admin）：库体积、条目数、近 30 天抓取/复用次数。

## 增量评论

平台没有「给我某时间之后的评论」这种参数，所以增量靠**按评论 id 合并**：

1. 每条评论第一次入库时记 `first_seen_at`；重复采到只更新正文/点赞数和 `fetched_at`。
2. 过了评论窗口（默认 24 小时）再采同一条作品，会重新拿一次最新列表 —— 新评论通常在最前面，
   老评论继续留在库里，不会被覆盖或删除。
3. 返回给任务的 `newComments` 是「本次真正新增的条数」（入库前后行数差），不是「本次抓到的条数」。
   日志会写：`评论 <作品>：新增 5 条（本次抓到 20 条，库里共 137 条）`。
4. 控制台：评论树里 7 天内首次出现的评论标「新」，作品列表显示 `评 137 +5`；
   `jobs.jsonl` 里也记 `newComments`，可以回看每次增量。

这个策略的边界：

- 如果平台只给「最新 N 条」且你采的 N 很小，早期评论可能一直看不到 —— 想要全量就用 `--max-comments 0`。
- 我们不会把「掉出当前页」的评论当成删除处理：评论在平台上被删了，库里仍然保留（这是有意为之，
  线索和统计都靠它）。需要清理走清理/回收流程。
- 楼中楼单独记 `with_replies`；只采了一级评论的任务不会让「需要回复」的任务误判为已采全。

## 前端展示

- 采集页 → 已采数据：作品列表带 `评 137 +5`（最近 7 天新增）；详情页有「媒体 N 个」，点开走 `/api/media` 读 blob（视频直接在浏览器播放/下载）。
- 用户管理 → 共享内容库：作品/评论/媒体数量、库体积、引用数、近 30 天抓取与复用次数、复用率；
  「预览回收」列出无引用且超过保留期的作品，「执行回收」需要输入「确认回收」。

## 清理

共享模式下评论只有一份，所以清理（「超过 N 天、且没被任何筛选词命中」）变成
**写 `user_masks` 对这个用户隐藏**，不删共享数据。预览/执行接口和执行前一致：

```bash
GET  /api/admin/cleanup?days=30
POST /api/admin/cleanup   { "days": 30, "confirm": "确认清理" }
```

服务端判断：这个用户在共享库里有引用就按共享库算（隐藏），没有引用（还没迁移的老数据）就按文件算（删除）。

真正腾空间用回收站：

```bash
mediacrawl content gc --root ./data --days 30          # 预览
mediacrawl content gc --root ./data --days 30 --apply  # 删除 0 引用且 30 天没再出现的作品、其评论、孤儿 blob
```

`user_masks` 里被隐藏的评论不清空共享数据；需要「彻底不看了」时才用 gc。

## 导入旧数据

```bash
mediacrawl content import --root ./data                 # 预览
mediacrawl content import --root ./data --apply         # 幂等导入，不动原文件
mediacrawl content import --root ./data --apply --prune-legacy   # 导入后把原文件搬到 users/<名>/.legacy/
mediacrawl content import --root ./data --apply --user 张三      # 只导一个用户
```

导入不会声称「评论已全量」，所以下一次要更多评论的任务仍会去抓，不会因为导入而漏数据。

## 回退

- 整个共享库：`OMC_SHARED=0`（或 `config.json` 的 `"enabled": false`）→ 回到按用户落盘，历史 refs 不影响。
- 单个任务：不传 `--shared` 即按用户落盘（CLI）；控制台默认共享。
- 数据：共享库只是新增的 `<out>/shared/`，删掉它不会动用户目录里的文件和线索。
