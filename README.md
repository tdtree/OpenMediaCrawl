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

**断点续爬**：进度存在 `<out>/.crawl-state-<平台>-<类型>.json`，中断后原命令再跑一遍，已经采过的作品和评论自动跳过。

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

表单选平台、填关键词、勾评论 / 下载，点「开始采集」；实时日志、任务列表、结果文件一键下载。默认只监听本机。

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
- **登录态存在哪？** 本机 `~/.catbus/`，不会上传到任何地方。

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
