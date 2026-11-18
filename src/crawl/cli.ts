import { join } from 'node:path'
import { CatbusError, toCatbusError } from '../core/errors.js'
import { createSubprocessClient } from './client.js'
import { CRAWL_PLATFORMS, CRAWL_TYPES, DEFAULT_CRAWL_OPTIONS, mergeCrawlConfig, normalizeCrawlOptions } from './config.js'
import { runCrawl } from './job.js'
import { openContentStore } from './shared/store.js'
import { loadSharedConfig, policyFrom } from './shared/config.js'
import { importLegacy } from './shared/import.js'
import { generateWordCloud } from './wordcloud.js'
import { startUiServer, STAR } from './ui.js'
import type { CrawlOptions } from './types.js'

const HELP = `OpenMediaCrawl — 批量采集小红书 / 抖音 / 快手 / B站 / 微博 / TikTok / X

用法:
  mediacrawl crawl --platform <xhs|douyin|kuaishou|bilibili|weibo|tiktok|x> --type <search|detail|creator> [选项]
  mediacrawl content <import|stats|gc> [选项]
  mediacrawl wordcloud --in <评论文件 .jsonl|.json|.csv> --out cloud.png
  mediacrawl ui [--port 8080] [--host 127.0.0.1] [--out ./data]

crawl 选项:
  --keywords "词1,词2"     search：关键词（逗号分隔）
  --ids "id或链接,..."      detail：作品 ID / 链接
  --creators "id或链接,..." creator：博主 ID / 主页链接
  --max-items 50           每个关键词 / 博主最多采多少条
  --sort latest            搜索排序（取值见 mediacrawl platforms <平台>）
  --comments               同时采一级评论
  --sub-comments           同时采二级评论（楼中楼）
  --max-comments 0         每条作品 / 每条评论最多采多少条（0 = 不限，默认；热门视频会很慢）
  --media                  下载图片 / 视频（共享模式按 sha256 只存一份）
  --save jsonl             json | jsonl | csv | sqlite
  --out ./data             输出目录（断点续爬状态也存在这里）
  --sleep 2-5              每次请求之间随机等待的秒数
  --shared                 走共享内容库 <out>/shared（同一个词不再重复请求/保存）
  --shared-dir <目录>      指定共享库目录
  --refresh auto           复用策略：auto 按 TTL | always 强制重抓 | never 有就不抓
  --config crawl.yaml      从 YAML / JSON 读选项，命令行优先
  --quiet                  只输出结果 JSON

content 子命令（共享库）:
  import [--root ./data] [--apply] [--prune-legacy] [--user 名字]
                           把旧的按用户落盘数据导入共享库；默认只统计
  stats  [--root ./data]    作品/评论/媒体数量与近 30 天复用率
  gc     [--root ./data] --days 30 [--apply]
                           回收没有任何用户引用的旧内容与孤立媒体

先登录（复用 catbus 登录态）：mediacrawl <platform> auth login
`

function parseFlags(argv: string[]): { flags: Record<string, unknown>; positionals: string[] } {
  const flags: Record<string, unknown> = {}
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) { positionals.push(arg); continue }
    const raw = arg.slice(2)
    const equals = raw.indexOf('=')
    const key = (equals >= 0 ? raw.slice(0, equals) : raw).replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())
    const supplied = equals >= 0 ? raw.slice(equals + 1) : argv[i + 1]
    const bool = ['comments', 'subComments', 'media', 'quiet', 'help', 'apply', 'pruneLegacy', 'shared'].includes(key)
    if (bool) { flags[key] = equals >= 0 ? supplied !== 'false' : true; continue }
    if (supplied == null || supplied.startsWith('--')) throw new CatbusError('USAGE', `选项 --${raw} 缺少值`)
    flags[key] = supplied
    i++
  }
  return { flags, positionals }
}

function validate(options: CrawlOptions): void {
  if (!CRAWL_PLATFORMS.includes(options.platform)) throw new CatbusError('USAGE', `不支持的采集平台：${options.platform}`)
  if (!CRAWL_TYPES.includes(options.type)) throw new CatbusError('USAGE', `不支持的采集类型：${options.type}`)
  if (!['json', 'jsonl', 'csv', 'sqlite'].includes(options.save)) throw new CatbusError('USAGE', `不支持的存储格式：${options.save}`)
  if (!Number.isFinite(options.maxItems) || options.maxItems < 1) throw new CatbusError('USAGE', '--max-items 必须是正整数')
}

export async function runOpenMediaCommand(argv: string[]): Promise<number> {
  const command = argv[0]
  if (command == null || command === '--help' || command === '-h') { process.stdout.write(HELP); return 0 }
  const { flags, positionals } = parseFlags(argv.slice(1))
  if (flags.help) { process.stdout.write(command === 'crawl' ? HELP : `${command}\n${HELP}`); return 0 }
  try {
    if (command === 'wordcloud') {
      const input = String(flags.in ?? '')
      const output = String(flags.out ?? '')
      if (!input || !output) throw new CatbusError('USAGE', 'wordcloud 需要 --in 和 --out')
      const result = await generateWordCloud(input, output)
      process.stdout.write(JSON.stringify({ ok: true, data: result }) + '\n')
      return 0
    }
    if (command === 'ui') {
      const host = String(flags.host ?? process.env.OMC_UI_HOST ?? '127.0.0.1')
      const handle = await startUiServer({ port: Number(flags.port ?? positionals[0] ?? 8080), host, out: String(flags.out ?? DEFAULT_CRAWL_OPTIONS.out) })
      const shown = handle.host === '0.0.0.0' || handle.host === '::' ? '127.0.0.1' : handle.host
      process.stderr.write(`OpenMediaCrawl UI: http://${shown}:${handle.port}${handle.host === '0.0.0.0' ? `（监听 0.0.0.0:${handle.port}，容器/局域网可访问）` : ''}\n`)
      if (handle.bootstrap) {
        process.stderr.write(`\n首次启动，已创建管理员 ${handle.bootstrap.username} / ${handle.bootstrap.password}\n登录后可在页面里改密码或新建用户；用户数据各自独立，admin 能看到全部。\n\n`)
      }
      await new Promise<void>((resolve) => handle.server.once('close', resolve))
      return 0
    }
    if (command === 'content') {
      const sub = positionals[0] ?? 'stats'
      const root = String(flags.root ?? DEFAULT_CRAWL_OPTIONS.out)
      const dir = String(flags.sharedDir ?? join(root, 'shared'))
      const store = openContentStore(dir)
      try {
        if (sub === 'import') {
          const report = await importLegacy(root, store, {
            apply: Boolean(flags.apply),
            pruneLegacy: Boolean(flags.pruneLegacy),
            users: flags.user ? [String(flags.user)] : undefined,
          })
          process.stdout.write(JSON.stringify({ ok: true, data: { dir, ...report } }) + '\n')
          return 0
        }
        if (sub === 'stats') {
          process.stdout.write(JSON.stringify({
            ok: true,
            data: {
              dir,
              config: await loadSharedConfig(dir),
              usage: store.usage(),
              reuse: store.reuseStats(Date.now() - 30 * 24 * 3600 * 1000),
            },
          }) + '\n')
          return 0
        }
        if (sub === 'gc') {
          const plan = store.gc({ days: Number(flags.days ?? 30), apply: Boolean(flags.apply) })
          process.stdout.write(JSON.stringify({ ok: true, data: plan }) + '\n')
          return 0
        }
        throw new CatbusError('USAGE', `未知 content 子命令：${sub}`, { hint: 'mediacrawl content import|stats|gc' })
      } finally { store.close() }
    }
    if (command !== 'crawl') throw new CatbusError('USAGE', `未知命令：${command}`, { hint: 'mediacrawl --help' })
    const configPath = typeof flags.config === 'string' ? flags.config : undefined
    // --shared-dir 是 --shared 的「指定目录」版本，归一成同一个字段。
    const flagValues = flags.sharedDir && flags.shared === undefined ? { ...flags, shared: flags.sharedDir } : flags
    const options = await mergeCrawlConfig(configPath, flagValues)
    validate(options)
    const sharedDir = options.shared === true ? join(options.out, 'shared') : typeof options.shared === 'string' ? options.shared : null
    const store = sharedDir ? openContentStore(sharedDir) : null
    try {
      const result = await runCrawl(options, {
        client: createSubprocessClient(options.platform, { sort: options.sort }),
        ...(store && sharedDir
          ? { content: store, user: String(process.env.OMC_USER ?? 'cli'), jobId: `cli-${Date.now()}`, policy: policyFrom(await loadSharedConfig(sharedDir), options.refresh) }
          : {}),
        onEvent: (event) => { if (!options.quiet && event.type !== 'item' && event.type !== 'comment' && event.type !== 'error') process.stderr.write(`[mediacrawl] ${event.message}\n`) },
      })
      process.stdout.write(JSON.stringify({ ok: true, data: result }) + '\n')
      if (shouldNag(options.quiet, process.env.OPENMEDIACRAWL_NO_NAG)) process.stderr.write(STAR + '\n')
      return 0
    } finally { store?.close() }
  } catch (error) {
    const e = toCatbusError(error)
    process.stderr.write(`[mediacrawl] ${e.message}\n`)
    process.stdout.write(JSON.stringify({ ok: false, error: e.toJSON() }) + '\n')
    return e.exitCode
  }
}

export { HELP, parseFlags, validate, normalizeCrawlOptions }

export function shouldNag(quiet: boolean, envValue = process.env.OPENMEDIACRAWL_NO_NAG): boolean {
  return !quiet && envValue !== '1'
}
