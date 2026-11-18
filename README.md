<div align="center">

# OpenMediaCrawl

**MIT 开源、可商用的自媒体平台批量采集工具**<br>
小红书 · 抖音 · 快手 · B 站 · 微博 · TikTok · X —— 关键词搜索、作品详情、博主主页、评论 / 二级评论、图片视频下载、断点续爬、词云、Web 界面

[![GitHub stars](https://img.shields.io/github/stars/Tommyapi/OpenMediaCrawl?style=for-the-badge&logo=github&color=F5C518)](https://github.com/Tommyapi/OpenMediaCrawl/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-A6E3A1?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![Tests](https://img.shields.io/badge/tests-1067%20passed-89B4FA?style=for-the-badge)](tests)

**简体中文** · [English](README.en.md)

### ⭐ 如果它帮你省了时间，请点右上角 Star —— 这是我们继续维护的最大动力 ⭐

</div>

---

## 🚀 5 步跑通（全部在本机，不装浏览器、不装 Python）

```
 ① 启动                ② 绑账号                 ③ 采集
 mediacrawl ui         账号与设置 →             采集 → 平台 + 关键词
 打开 127.0.0.1:8080   扫码登录 / 粘贴 Cookie   勾「评论」→ 开始采集
        │                     │                        │
        └─────────────────────┴────────────────────────┘
                              ↓
 ④ 线索                                    ⑤ 触达
 打开「线索」自动同步（按评论 ID 去重）      采集页勾选评论 → 加入候选池
 多关键词筛选（空格或 / 分隔，OR）→ 导出     触达页填话术 → 统一回复 / 私信
```

- 首次启动会打印管理员密码（也可用 `OMC_ADMIN_PASSWORD` 指定）；默认只监听 `127.0.0.1`。
- 「每视频评论上限」默认 0（一级评论全量、自动翻页），二级评论按需拉取；热门视频全量会很慢，想快采再填 20/100。
- 群发默认单日 25 条、一次最多 50 条、间隔 30–90 秒随机，可在「账号与设置」里改；发送前二次确认。
- 数据在 `./data/users/<用户名>/`，登录态在各自的 `.catbus/`，互不可见。

---

## ✨ 为什么选 OpenMediaCrawl

| | OpenMediaCrawl | MediaCrawler |
|---|---|---|
| 许可证 | **MIT，个人和商业项目都能用** | 非商业学习许可，商用需作者书面同意 |
| 运行环境 | **只要 Node.js**，不装 Python、不开浏览器 | Python + Playwright / 连接本机 Chrome |
| 采集方式 | 纯 HTTP + 算法签名（基于 [catbus](https://github.com/cv-cat/catbus)），轻、快 | 浏览器自动化 |
| 输出格式 | JSON / JSONL / CSV（Excel 直接打开）/ SQLite | CSV / JSON / JSONL / Excel / SQLite / MySQL |
| 断点续爬 | ✅ **开源版就有**，自动跳过已采过的作品和评论 | 仅付费 Pro 版 |
| Web 界面 | ✅ `mediacrawl ui` 本地网页点点就能跑 | ✅ |
| 评论词云 | ✅ 纯 Node 中文分词，不依赖 Python | ✅ |

> OpenMediaCrawl 是独立实现（clean-room），没有复制或引用 MediaCrawler 的任何代码；功能目标相近，代码完全不同。

## 📊 平台支持

| 平台 | 关键词搜索 | 作品详情 | 博主主页 | 一级评论 | 二级评论 | 图片 / 视频下载 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 小红书 `xhs` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 抖音 `douyin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 快手 `kuaishou` | ✅ ¹ | ✅ | ✅ | ✅ | ✅ | ✅ |
| B 站 `bilibili` | ✅ | ✅ | ✅ | ✅ | ✅ ² | ✅ |
| 微博 `weibo` | ✅ ³ | ✅ | ✅ | ✅ | — | — |
| TikTok `tiktok` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| X `x` | ✅ | ✅ | ✅ | ✅ | — | ✅ |

¹ 快手搜索不支持排序筛选 ² B 站楼中楼支持视频、专栏、图文动态 ³ 微博搜索只取第一页
平台底层能力（发布、私信、直播弹幕、闲鱼 / 淘宝 / 京东等）见 [能力矩阵](docs/capabilities.md)。

## 🚀 快速开始

```bash
git clone https://github.com/Tommyapi/OpenMediaCrawl.git
cd OpenMediaCrawl
npm ci && npm run build && npm link     # 之后全局可用 mediacrawl 命令

mediacrawl doctor                        # 检查环境
mediacrawl xhs auth login                # 扫码登录小红书（登录态存在本机）
```

需要 Node.js 22.22+ / 24.15+ / 26+（Windows、macOS、Linux 都行）。

## 🕷️ 批量采集

```bash
# 关键词搜索：每个关键词采 50 条，带评论和二级评论，存成 Excel 能打开的 CSV
mediacrawl crawl --platform xhs --type search --keywords "露营,徒步" --max-items 50 \
  --comments --sub-comments --save csv --out ./data

# 指定作品：抓详情 + 下载图片视频，存 SQLite
mediacrawl crawl --platform bilibili --type detail --ids "BV1xx411c7mD,BV1yy411c7mE" --media --save sqlite

# 指定博主：主页资料 + 他发的作品 + 评论
mediacrawl crawl --platform douyin --type creator --creators "https://www.douyin.com/user/MS4wLjABAAAA..." --comments
```

| 选项 | 说明 | 默认 |
|---|---|---|
| `--platform` | `xhs` `douyin` `kuaishou` `bilibili` `weibo` `tiktok` `x` | 必填 |
| `--type` | `search` 关键词 / `detail` 指定作品 / `creator` 指定博主 | 必填 |
| `--keywords` `--ids` `--creators` | 逗号分隔，ID 和链接都行 | |
| `--max-items` | 每个关键词 / 博主最多采多少条 | 50 |
| `--sort` | 搜索排序，如 `latest`（各平台取值见 `mediacrawl platforms xhs`） | 平台默认 |
| `--comments` / `--sub-comments` | 采一级评论 / 二级评论 | 关 |
| `--max-comments` | 每条作品、每条评论最多采多少条 | 20 |
| `--media` | 下载图片视频到 `<out>/<平台>/media/<作品ID>/` | 关 |
| `--save` | `json` `jsonl` `csv` `sqlite` | `jsonl` |
| `--out` | 输出目录 | `./data` |
| `--sleep` | 请求间隔秒数，可写区间 `2-5` | `2-5` |
| `--config` | 从 YAML / JSON 读取选项（命令行优先） | |
| `--quiet` | 只输出结果 JSON | |

**断点续爬**：进度存在 `<out>/.crawl-state-<平台>-<类型>.json`，记着采过的作品 / 评论 / 博主 id，以及每个任务（`search:露营`、`creator:u9`）的翻页游标和是否跑完。中断（Ctrl+C、断网、风控停下）后原命令再跑一遍：已完成的关键词整段跳过，没跑完的从存下的游标接着翻，不从第 1 页重走；游标每拿到一次就落盘。上一轮正常跑完的 state 只当去重集合用，关键词会重新查一遍。

**遇到风控会停**：登录失效、出验证码时任务立即停止并提示原因，不会反复重试把账号越弄越糟。重新 `mediacrawl <平台> auth login` 后继续即可。

配置文件示例 `crawl.yaml`：

```yaml
platform: xhs
type: search
keywords: 露营,徒步
max-items: 100
comments: true
sub-comments: true
save: csv
out: ./data
sleep: 3-6
```

```bash
mediacrawl crawl --config crawl.yaml --max-items 20   # 命令行覆盖配置文件
```

## 📁 输出

```
data/
├── xhs/
│   ├── search_item_2026-11-01.csv       # 作品：标题、正文、作者、时间、点赞、评论、收藏、分享、链接 + 完整 JSON
│   ├── search_comment_2026-11-01.csv    # 评论（含二级评论，parent_id 指向父评论）
│   └── media/<作品ID>/...               # --media 下载的图片视频
└── .crawl-state-xhs-search.json         # 断点续爬进度
```

SQLite 模式写入一个库，`items` / `comments` / `creators` 三张表，按 `(platform, id)` 去重更新。

## 🧩 共享内容库（多账号 / 多用户去重）

几个账号采同一个关键词时，搜索结果会大量重叠。Web 控制台默认打开共享库（`OMC_SHARED=0` 关闭），
命令行加 `--shared` 开启：

- 一条作品以 **`(平台, 作品 id)`** 唯一。第一次抓到的正文、评论、媒体入库；
  后面无论是哪个用户、哪个登录账号再采到同一条，都直接复用库里的数据 —— 不再请求平台，也不在用户目录里再存一份。
- 媒体按 **sha256** 只存一份：同一个视频被搬运号二次发布的，也只占一份字节。
- 用户目录里只留「我采到过哪些」的引用（refs），以及各自的提取结果（线索、候选池、词库、私信/群发记录）。
  **内容是公用的，提取是各算各的。**
- 两个账号同时命中同一条时靠租约（`claims`）只放一个去请求，另一个等结果。
- 增量评论：每条评论记 `first_seen_at`。过了评论窗口重抓时按评论 id 合并——老评论保留，只追加新的；
  采集结果里的 `newComments` 是真正新增的条数，列表和评论树会给 7 天内新出现的评论标「新」。
- 控制台里能看到媒体的下载结果（详情页「媒体 N 个」，点开走 `/api/media` 读共享库的 blob），
  「用户管理 → 共享内容库」有体积、复用率和「预览/执行回收」。

```
data/shared/
├── content.sqlite              # items / comments / creators / refs / fetch_log
├── blobs/<aa>/<sha256>.<ext>   # 媒体实体，按内容哈希
└── config.json                 # 复用窗口：作品正文 30 天、评论 24 小时、媒体永久
```

```bash
mediacrawl content import --root ./data            # 预览：旧数据能导入多少
mediacrawl content import --root ./data --apply    # 幂等导入，不删原文件
mediacrawl content stats  --root ./data            # 作品/评论/媒体数量 + 近 30 天复用率
mediacrawl content gc     --root ./data --days 30 --apply   # 回收没人引用的旧内容
```

复用窗口可在 `data/shared/config.json` 里改（`itemTtlDays` / `commentTtlHours`）；
`--refresh always` 强制重抓、`--refresh never` 有就不抓。控制台里清理旧评论变成「对自己隐藏」（`user_masks`），不动共享数据。

## ☁️ 评论词云

```bash
mediacrawl wordcloud --in ./data/xhs/search_comment_2026-11-01.jsonl --out cloud.png
```

<p align="center"><img src="docs/assets/wordcloud-demo.png" width="80%" alt="词云示例"></p>

用 Node 自带的 ICU 词典分词（`Intl.Segmenter`），不需要 jieba 或 Python。

## 🖥️ Web 界面

```bash
mediacrawl ui --port 8080     # 打开 http://127.0.0.1:8080
```

首次启动会自动建管理员 `admin`：密码取 `OMC_ADMIN_PASSWORD`，没设就随机生成并打印在终端。打开页面要先登录，管理员登录后能在页面里改密码、新建用户。

登录后是「侧栏 + 5 个视图」：**概览 / 采集 / 线索 / 触达 / 账号与设置**，地址栏带 hash（如 `#/leads`），刷新停在当前页。

- **概览**：累计线索、今日新增、联系方式命中、运行中任务，近 14 天柱状图和平台占比。
- **采集**：表单分「基础 / 范围 / 高级」三组（平台、类型、关键词或作品/博主、每视频评论上限、是否抓评论与二级评论）；下面是已采数据：左列作品、右侧详情和一级/二级评论，评论可以按关键词（空格或 `/` 分隔，命中任意一个）过滤、勾选后批量加入候选池，也能单条回复。
- **线索**：表格（评论者 / 评论 / 联系方式 / 地域 / 命中词 / 时间），筛选即查（搜索支持多关键词 OR），50 条一页，行内展开详情；可导出全部 / 导出选中（默认脱敏），也可以把勾选的评论者直接「加入候选池」（按用户去重），之后到触达页按候选池群发。
- **触达**：候选池（勾选、批量移除、清空、手动添加测试号）、群发设置（类型、文案、话术模板、随机间隔、单日上限）、实时日志、任务列表（可停止、可看日志）、单条互动。群发只发勾选的人；手动加号会先把 UID / sec_uid / 主页链接解析成 sec_uid，认不出不让加。话术模板按用户存，最多 50 套，发之前从下拉里挑一套套进文案再改；群发前可先给自己的小号发一条验证收信。
- **账号与设置**：扫码登录 / 粘贴 Cookie / 导入本机抓取的 `dy.json` / 检查登录态、账号切换、删除本地登录态、词库管理、发送参数与清空派生数据、改自己的密码。本机抓取用 `npm run capture:douyin`（见 [登录指南](docs/guide/login.md#一键抓取本机-chrome)）。
- **用户管理**（仅 admin）：按天看每个账号抓了哪些关键词、采了多少作品和评论、发起了多少私信、沟通了多少客户；下方是账号概览（作品 / 评论 / 线索 / 登录态 / 磁盘占用 / 最近活跃），支持 7/14/30 天切换与按用户筛选。

线索库会在打开「线索」页时自动从已采评论同步（按评论 ID 去重），不需要手动「生成」。

采集默认每视频最多采 20 条一级评论（`--max-comments 0` 表示不限，遇多页自动翻；二级评论按需拉取）。数据清理在「用户管理 → 数据清理」：默认删超过 30 天、从未被筛选词命中的评论正文，线索与断点记录保留。默认只监听本机；要用 Docker 部署到另一台机器（从 ghcr.io 拉镜像），见 [docs/guide/docker.md](docs/guide/docker.md) 的「Web 控制台镜像」。

### 多用户

每个用户的采集结果在 `<--out>/users/<用户名>/`，登录态在自己的 `users/<用户名>/.catbus/`。
内容本身放在 `<--out>/shared/`（共享库）：同一件作品只留一份正文/评论/媒体，
每个用户靠引用（refs）看到自己采过的部分；线索、候选池、词库、群发记录仍然各算各的。

账号有三种状态：**待审核 / 正常 / 停用**。登录页可以自助申请（账号填真实姓名、密码自己设），提交后是「待审核」，管理员在「账号与设置 → 用户」里点「通过」才能登录；管理员也可以停用、启用、重置密码、升降权（至少保留一个 admin）。用户存在 `<OMC_HOME|~/.openmediacrawl>/users.json`，密码只存 scrypt 哈希；会话在内存里，进程重启后要重新登录。规则、接口和安全边界见 [docs/guide/users.md](docs/guide/users.md)。

## 🤖 单条命令 & AI Agent

批量采集之外，底层的每个平台能力都能单独调用，输出统一 JSON，适合脚本和 AI Agent：

```bash
mediacrawl xhs item search 露营 --sort latest --limit 20
mediacrawl douyin comment list https://www.douyin.com/video/7xxxxxxxx --limit 50
mediacrawl bilibili user items 2 --all
```

（`catbus` 命令名同样可用，完全兼容上游。）

## ❓ FAQ

- **能商用吗？** 能。MIT 许可，保留 LICENSE 里的版权声明即可。
- **需要 Python / Chrome 吗？** 都不需要，只要 Node.js。
- **采集太快被限制了？** 调大 `--sleep`（如 `5-10`），减小 `--max-items`，换个时间段再跑。
- **登录态存在哪？** 本机 `~/.catbus/`，不会上传到任何地方；Web 界面里各用户存在自己的 `<--out>/users/<用户名>/.catbus/`。

## ⚠️ 合理使用

请遵守各平台服务条款和你所在地的数据、个人信息保护法律；控制频率、只采需要的数据、妥善保管输出文件。本项目不提供账号，也不帮你绕过平台的人机验证。

## 🙏 致谢

平台签名和客户端来自 [cv-cat/catbus](https://github.com/cv-cat/catbus)（MIT）及其上游仓库 [Spider_XHS](https://github.com/cv-cat/Spider_XHS)、[DouYin_Spider](https://github.com/cv-cat/DouYin_Spider)、[KuaiShou-Spider](https://github.com/cv-cat/KuaiShou-Spider)、[BilibiliApis](https://github.com/cv-cat/BilibiliApis)、[WeiboApis](https://github.com/cv-cat/WeiboApis)、[TiktokApis](https://github.com/cv-cat/TiktokApis)、[XApis](https://github.com/cv-cat/XApis)。OpenMediaCrawl 在其之上增加了批量任务、断点续爬、多格式存储、媒体批量下载、词云和 Web 界面。

## 📈 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Tommyapi/OpenMediaCrawl&type=Date)](https://star-history.com/#Tommyapi/OpenMediaCrawl&Date)

## Support / 打赏

如果这个项目帮到了你，欢迎点个 ⭐ Star，也欢迎打赏支持持续维护（请按网络转对应币种，转错网络无法找回）：

| 网络 | 币种 | 地址 |
|---|---|---|
| TRON (TRC20) | USDT | `TNGdTwE6opH6rmUyoG1JUR7FSyEb4k273R` |
| Ethereum / BSC (BEP20) / Polygon / Arbitrum / Base | USDT / ETH | `0x59c43144a862b351fa1086ae842d1327c9d91613` |
| Bitcoin | BTC | `1RS6tWXHregLfEsiPzVUCUBuhgDg5uTSV` |
| Solana | USDT | `HZguEXfTtLChNdJTxAYCbcGscaqikz8JYrEpUhEyeVd9` |

## License

[MIT](LICENSE) © 2026 cv-cat（catbus 原始代码）· 2026 tommyapi（OpenMediaCrawl 新增部分）
