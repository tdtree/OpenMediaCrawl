import { readFile } from 'node:fs/promises'
import { parseRefresh } from './shared/config.js'
import type { CrawlOptions, CrawlPlatform, CrawlType, SaveFormat } from './types.js'
import { splitValues } from './types.js'

export const CRAWL_PLATFORMS: CrawlPlatform[] = ['xhs', 'douyin', 'kuaishou', 'bilibili', 'weibo', 'tiktok', 'x']
export const CRAWL_TYPES: CrawlType[] = ['search', 'detail', 'creator']

export const DEFAULT_CRAWL_OPTIONS: Omit<CrawlOptions, 'platform' | 'type'> = {
  // 默认把一级评论采全；热门视频会慢，需要快采时在表单/CLI 里显式填 20、100。
  keywords: [], ids: [], creators: [], maxItems: 50, comments: false, subComments: false, maxComments: 0,
  media: false, save: 'jsonl', out: './data', sleep: '2-5', quiet: false, shared: false, refresh: 'auto',
}

function scalar(value: string): unknown {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '')
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1).split(',').map((v) => scalar(v))
  return trimmed
}

function camel(value: string): string {
  return value.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())
}

export async function readCrawlConfig(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8')
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return (parsed.crawl as Record<string, unknown> | undefined) ?? parsed
  } catch {}
  const output: Record<string, unknown> = {}
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, '').trim()
    if (!clean || clean.startsWith('-')) continue
    const index = clean.indexOf(':')
    if (index < 1) continue
    const key = camel(clean.slice(0, index).trim())
    const value = clean.slice(index + 1).trim()
    output[key] = value ? scalar(value) : ''
  }
  return output
}

export function normalizeCrawlOptions(input: Record<string, unknown>): CrawlOptions {
  const platform = String(input.platform ?? '') as CrawlPlatform
  const type = String(input.type ?? '') as CrawlType
  const save = String(input.save ?? DEFAULT_CRAWL_OPTIONS.save) as SaveFormat
  const bool = (key: string, fallback: boolean) => {
    const value = input[key]
    if (value == null) return fallback
    return value === true || value === 'true' || value === 1 || value === '1'
  }
  return {
    platform, type,
    keywords: splitValues(input.keywords as string | string[] | undefined),
    ids: splitValues(input.ids as string | string[] | undefined),
    creators: splitValues(input.creators as string | string[] | undefined),
    maxItems: Number(input.maxItems ?? DEFAULT_CRAWL_OPTIONS.maxItems),
    comments: bool('comments', DEFAULT_CRAWL_OPTIONS.comments),
    subComments: bool('subComments', DEFAULT_CRAWL_OPTIONS.subComments),
    maxComments: Math.max(0, Number(input.maxComments ?? DEFAULT_CRAWL_OPTIONS.maxComments)),
    media: bool('media', DEFAULT_CRAWL_OPTIONS.media),
    save, out: String(input.out ?? DEFAULT_CRAWL_OPTIONS.out),
    sleep: String(input.sleep ?? DEFAULT_CRAWL_OPTIONS.sleep),
    sort: typeof input.sort === 'string' && input.sort ? input.sort : undefined,
    quiet: bool('quiet', false), config: typeof input.config === 'string' ? input.config : undefined,
    // --shared 不带值（true）时用 <out>/shared；显式目录就用它；false 关闭。
    shared: input.shared === true || input.shared === 'true'
      ? true
      : typeof input.shared === 'string' && input.shared && input.shared !== 'false' ? input.shared : false,
    refresh: parseRefresh(input.refresh),
  }
}

export async function mergeCrawlConfig(configPath: string | undefined, cli: Record<string, unknown>): Promise<CrawlOptions> {
  const fileValues = configPath ? await readCrawlConfig(configPath) : {}
  return normalizeCrawlOptions({ ...fileValues, ...Object.fromEntries(Object.entries(cli).filter(([, value]) => value !== undefined)) })
}
