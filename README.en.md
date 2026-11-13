<div align="center">

# OpenMediaCrawl

**MIT-licensed, commercial-friendly batch crawler for Chinese & global social platforms**<br>
Xiaohongshu (RedNote) · Douyin · Kuaishou · Bilibili · Weibo · TikTok · X — keyword search, post details, creator pages, comments & replies, media download, resumable jobs, word clouds, web UI

[![GitHub stars](https://img.shields.io/github/stars/Tommyapi/OpenMediaCrawl?style=for-the-badge&logo=github&color=F5C518)](https://github.com/Tommyapi/OpenMediaCrawl/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-A6E3A1?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)

[简体中文](README.md) · **English**

### ⭐ If this saves you time, please star the repo — it keeps the project maintained ⭐

</div>

---

## Why OpenMediaCrawl

| | OpenMediaCrawl | MediaCrawler |
|---|---|---|
| License | **MIT — personal and commercial use** | Non-commercial learning license |
| Runtime | **Node.js only** — no Python, no browser | Python + Playwright / local Chrome (CDP) |
| How it fetches | Plain HTTP + algorithmic signing (via [catbus](https://github.com/cv-cat/catbus)) | Browser automation |
| Output | JSON / JSONL / CSV (Excel-ready) / SQLite | CSV / JSON / JSONL / Excel / SQLite / MySQL |
| Resume interrupted jobs | ✅ **in the open-source version** | Paid Pro edition only |
| Web UI | ✅ `mediacrawl ui` | ✅ |
| Comment word cloud | ✅ pure Node segmentation | ✅ |

> OpenMediaCrawl is an independent clean-room implementation. It contains no code from MediaCrawler.

## Platform support

| Platform | Search | Post detail | Creator | Comments | Replies | Media download |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Xiaohongshu `xhs` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Douyin `douyin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Kuaishou `kuaishou` | ✅ ¹ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bilibili `bilibili` | ✅ | ✅ | ✅ | ✅ | ✅ ² | ✅ |
| Weibo `weibo` | ✅ ³ | ✅ | ✅ | ✅ | — | — |
| TikTok `tiktok` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| X `x` | ✅ | ✅ | ✅ | ✅ | — | ✅ |

¹ no sort/filter ² videos, articles and image posts ³ first page only. Full low-level matrix: [docs/capabilities.md](docs/capabilities.md).

## Quick start

```bash
git clone https://github.com/Tommyapi/OpenMediaCrawl.git
cd OpenMediaCrawl
npm ci && npm run build && npm link     # makes the `mediacrawl` command available

mediacrawl doctor
mediacrawl xhs auth login                # QR-code login, session stays on your machine
```

Requires Node.js 22.22+ / 24.15+ / 26+ on Windows, macOS or Linux.

## Batch crawling

```bash
# 50 posts per keyword, with comments and replies, saved as Excel-ready CSV
mediacrawl crawl --platform xhs --type search --keywords "camping,hiking" --max-items 50 \
  --comments --sub-comments --save csv --out ./data

# specific posts + download images/videos, saved to SQLite
mediacrawl crawl --platform bilibili --type detail --ids "BV1xx411c7mD" --media --save sqlite

# a creator's profile and posts
mediacrawl crawl --platform tiktok --type creator --creators "https://www.tiktok.com/@someone" --comments
```

Options: `--keywords` `--ids` `--creators` (comma-separated IDs or URLs), `--max-items 50`, `--sort latest`, `--comments`, `--sub-comments`, `--max-comments 20`, `--media`, `--save json|jsonl|csv|sqlite`, `--out ./data`, `--sleep 2-5`, `--config crawl.yaml`, `--quiet`. Run `mediacrawl crawl --help` for details.

- **Resumable**: progress lives in `<out>/.crawl-state-<platform>-<type>.json` — saved post/comment/creator ids plus, per task (`search:camping`, `creator:u9`), the paging cursor and whether it finished. After an interruption the same command skips finished keywords and resumes the unfinished ones from the saved cursor instead of page 1; cursors are written as soon as they arrive. A state file from a run that finished is only used as a dedupe set, so keywords are queried again.
- **Stops on risk control**: on expired login or captcha the job stops immediately with a clear message instead of hammering the platform.
- **Config files**: any option can come from YAML/JSON; command-line flags win.

## Word cloud & web UI

```bash
mediacrawl wordcloud --in ./data/xhs/search_comment_2026-11-01.jsonl --out cloud.png
mediacrawl ui --port 8080        # http://127.0.0.1:8080
```

First run creates an `admin` account — the password comes from `OMC_ADMIN_PASSWORD`, otherwise one is generated and printed in the terminal — and the page requires a login before anything else.

The left column signs you in: pick a platform, scan the QR code (or paste a cookie), and switch between saved accounts; each user's signed-in state lives in their own `<out>/users/<name>/.catbus/`. Collected posts stream into the preview column as cards that open a detail drawer (cover, title, body, author, likes / comments / collects, link to the original post) instead of jumping straight out. The **Interact** panel posts a comment or sends a DM: comment covers Douyin and Bilibili, DMs cover Douyin, Xiaohongshu, TikTok, Xianyu, Taobao and JD (`mediacrawl platforms <platform>` is the source of truth); every send asks for confirmation, is throttled to one action per 3s per platform + account (`MEDIACRAWL_ACTION_INTERVAL_MS`, otherwise `TOO_FAST`), caps text at 500 characters and never retries. The server listens on 127.0.0.1 only.

Multi-user: each account's data goes to `<out>/users/<name>/` with a per-user login state underneath, users cannot see each other, and an admin sees every job and file and can create, delete and re-role users from the page (the last admin is protected). Users live in `<OMC_HOME|~/.openmediacrawl>/users.json` as scrypt hashes; sessions are kept in memory, so a restart means logging in again. See [docs/guide/users.md](docs/guide/users.md).

<p align="center"><img src="docs/assets/wordcloud-demo.png" width="80%" alt="word cloud example"></p>

## Single commands & AI agents

Every underlying capability is also a one-shot command with a uniform JSON envelope:

```bash
mediacrawl xhs item search camping --sort latest --limit 20
mediacrawl douyin comment list https://www.douyin.com/video/7xxxxxxxx --limit 50
```

(The upstream `catbus` command name keeps working.)

## Responsible use

Follow each platform's terms of service and the data-protection laws that apply to you; keep request rates low and collect only what you need. This project provides no accounts and does not bypass human verification for you.

## Acknowledgements

Platform clients and signing come from [cv-cat/catbus](https://github.com/cv-cat/catbus) (MIT) and its upstream repos. OpenMediaCrawl adds batch jobs, resume, multi-format storage, bulk media download, word clouds and the web UI.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Tommyapi/OpenMediaCrawl&type=Date)](https://star-history.com/#Tommyapi/OpenMediaCrawl&Date)

## Support

If this project helps you, please give it a ⭐ — donations are welcome too (send each coin on the matching network; wrong-network transfers cannot be recovered):

| Network | Coin | Address |
|---|---|---|
| TRON (TRC20) | USDT | `TNGdTwE6opH6rmUyoG1JUR7FSyEb4k273R` |
| Ethereum / BSC (BEP20) / Polygon / Arbitrum / Base | USDT / ETH | `0x59c43144a862b351fa1086ae842d1327c9d91613` |
| Bitcoin | BTC | `1RS6tWXHregLfEsiPzVUCUBuhgDg5uTSV` |
| Solana | USDT | `HZguEXfTtLChNdJTxAYCbcGscaqikz8JYrEpUhEyeVd9` |

## License

[MIT](LICENSE) © 2026 cv-cat (original catbus code) · 2026 tommyapi (OpenMediaCrawl additions)
