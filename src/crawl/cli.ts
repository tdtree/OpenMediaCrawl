import { CatbusError, toCatbusError } from '../core/errors.js'
import { createSubprocessClient } from './client.js'
import { CRAWL_PLATFORMS, CRAWL_TYPES, DEFAULT_CRAWL_OPTIONS, mergeCrawlConfig, normalizeCrawlOptions } from './config.js'
import { runCrawl } from './job.js'
import { generateWordCloud } from './wordcloud.js'
import { startUiServer, STAR } from './ui.js'
import type { CrawlOptions } from './types.js'

const HELP = `OpenMediaCrawl — 批量采集小红书 / 抖音 / 快手 / B站 / 微博 / TikTok / X

用法:
  mediacrawl crawl --platform <xhs|douyin|kuaishou|bilibili|weibo|tiktok|x> --type <search|detail|creator> [选项]
  mediacrawl wordcloud --in <评论文件 .jsonl|.json|.csv> --out cloud.png
  mediacrawl ui [--port 8080] [--out ./data]

crawl 选项:
  --keywords "词1,词2"     search：关键词（逗号分隔）
  --ids "id或链接,..."      detail：作品 ID / 链接
  --creators "id或链接,..." creator：博主 ID / 主页链接
  --max-items 50           每个关键词 / 博主最多采多少条
  --sort latest            搜索排序（取值见 mediacrawl platforms <平台>）
  --comments               同时采一级评论
  --sub-comments           同时采二级评论（楼中楼）
  --max-comments 20        每条作品 / 每条评论最多采多少条
  --media                  下载图片 / 视频到 <out>/<平台>/media/<作品ID>/
  --save jsonl             json | jsonl | csv | sqlite
  --out ./data             输出目录（断点续爬状态也存在这里）
  --sleep 2-5              每次请求之间随机等待的秒数
  --config crawl.yaml      从 YAML / JSON 读选项，命令行优先
  --quiet                  只输出结果 JSON

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
    const bool = ['comments', 'subComments', 'media', 'quiet', 'help'].includes(key)
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
      const handle = await startUiServer({ port: Number(flags.port ?? positionals[0] ?? 8080), out: String(flags.out ?? DEFAULT_CRAWL_OPTIONS.out) })
      process.stderr.write(`OpenMediaCrawl UI: http://${handle.host}:${handle.port}\n`)
      await new Promise<void>((resolve) => handle.server.once('close', resolve))
      return 0
    }
    if (command !== 'crawl') throw new CatbusError('USAGE', `未知命令：${command}`, { hint: 'mediacrawl --help' })
    const configPath = typeof flags.config === 'string' ? flags.config : undefined
    const options = await mergeCrawlConfig(configPath, flags)
    validate(options)
    const result = await runCrawl(options, { client: createSubprocessClient(options.platform, { sort: options.sort }), onEvent: (event) => { if (!options.quiet && event.type !== 'item' && event.type !== 'comment' && event.type !== 'error') process.stderr.write(`[mediacrawl] ${event.message}\n`) } })
    process.stdout.write(JSON.stringify({ ok: true, data: result }) + '\n')
    if (shouldNag(options.quiet, process.env.OPENMEDIACRAWL_NO_NAG)) process.stderr.write(STAR + '\n')
    return 0
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
