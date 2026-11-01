import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Comment, Item, User } from '../src/core/schemas.js'
import { CatbusError } from '../src/core/errors.js'
import { mergeCrawlConfig } from '../src/crawl/config.js'
import { runCrawl } from '../src/crawl/job.js'
import { createStorage, readStoredRecords } from '../src/crawl/storage.js'
import { shouldNag } from '../src/crawl/cli.js'
import { createSubprocessClient } from '../src/crawl/client.js'
import { startUiServer } from '../src/crawl/ui.js'
import { generateWordCloud, tokenize } from '../src/crawl/wordcloud.js'
import type { CrawlOptions, CrawlPlatformClient } from '../src/crawl/types.js'

const item = (id: string): Item => ({ id, kind: 'text', url: `https://example.test/${id}`, title: id, text: id, author: null, created_at: null, cover: null, media: [], stats: { views: null, likes: null, comments: null, collects: null, shares: null }, price: null, status: 'published' })
const comment = (id: string, replies: number | null = null, parent_id: string | null = null): Comment => ({ id, item_id: 'i1', parent_id, author: null, text: `评论 ${id} 露营装备很好用`, created_at: null, stats: { likes: null, replies } })
const user = (id: string): User => ({ id, name: id, handle: id, avatar: null, url: null, bio: null, stats: { followers: null, following: null, items: null, likes: null } })

const options = (out: string, over: Partial<CrawlOptions> = {}): CrawlOptions => ({ platform: 'xhs', type: 'search', keywords: ['k'], ids: [], creators: [], maxItems: 1, comments: true, subComments: true, maxComments: 20, media: false, save: 'jsonl', out, sleep: '0', quiet: true, ...over })

function baseClient(calls: string[], over: Partial<CrawlPlatformClient> = {}): CrawlPlatformClient {
  return {
    async search(keyword, cursor) { calls.push(`search:${keyword}:${cursor}`); return { items: [item('i1'), item('i2')], hasMore: false, cursor: null } },
    async detail(id) { calls.push(`detail:${id}`); return item(id.replace('https://example.test/', '')) },
    async comments(ref) { calls.push(`comments:${ref}`); return [comment('c1', 2), comment('c3', 0)] },
    async subComments(_ref, cid) { calls.push(`sub:${cid}`); return [comment(`${cid}-r`, null, cid)] },
    async creator(id) { calls.push(`creator:${id}`); return user(id) },
    async creatorItems(id, cursor) { calls.push(`creatorItems:${id}:${cursor}`); return [] },
    async download(it, dir) { calls.push(`download:${it.id}:${dir.endsWith(it.id)}`); return 1 },
    ...over,
  }
}

const tmp: string[] = []
async function tempDir(prefix: string): Promise<string> { const d = await mkdtemp(join(tmpdir(), prefix)); tmp.push(d); return d }
afterEach(async () => { for (const d of tmp.splice(0)) await rm(d, { recursive: true, force: true }) })

describe('crawl job', () => {
  it('search → detail → comments → sub-comments (only when replies may exist), then resume skips saved items', async () => {
    const out = await tempDir('omc-job-')
    const calls: string[] = []
    const client = baseClient(calls)
    const first = await runCrawl(options(out), { client })
    expect(calls).toEqual(['search:k:null', 'detail:https://example.test/i1', 'comments:https://example.test/i1', 'sub:c1'])
    expect(first.counts).toMatchObject({ items: 1, comments: 3 })
    calls.length = 0
    const second = await runCrawl(options(out), { client })
    expect(calls).toEqual(['search:k:null'])
    expect(second.counts.items).toBe(0)
    expect(second.counts.skipped).toBe(1)
    const files = await readdir(join(out, 'xhs'))
    expect(files.filter((n) => n.endsWith('.jsonl')).sort()).toEqual([`search_comment_${new Date().toISOString().slice(0, 10)}.jsonl`, `search_item_${new Date().toISOString().slice(0, 10)}.jsonl`])
  })

  it('follows opaque cursors across pages and stops at max-items', async () => {
    const out = await tempDir('omc-page-')
    const calls: string[] = []
    const pages: Record<string, { items: Item[]; hasMore: boolean; cursor: string | null }> = {
      null: { items: [item('a'), item('b')], hasMore: true, cursor: 'tok-2' },
      'tok-2': { items: [item('c'), item('d')], hasMore: true, cursor: 'tok-3' },
    }
    const client = baseClient(calls, { async search(_k, cursor) { calls.push(`search:${cursor}`); return pages[String(cursor)]! } })
    const result = await runCrawl(options(out, { maxItems: 3, comments: false }), { client })
    expect(calls.filter((c) => c.startsWith('search'))).toEqual(['search:null', 'search:tok-2'])
    expect(result.counts.items).toBe(3)
  })

  it('detail type fetches each id exactly once and downloads media into <out>/<platform>/media/<id>', async () => {
    const out = await tempDir('omc-detail-')
    const calls: string[] = []
    await runCrawl(options(out, { type: 'detail', ids: ['x1', 'x2'], keywords: [], comments: false, media: true, maxItems: 5 }), { client: baseClient(calls) })
    expect(calls).toEqual(['detail:x1', 'download:x1:true', 'detail:x2', 'download:x2:true'])
  })

  it('creator type saves the creator and walks their items', async () => {
    const out = await tempDir('omc-creator-')
    const calls: string[] = []
    const client = baseClient(calls, { async creatorItems(id, cursor) { calls.push(`creatorItems:${id}:${cursor}`); return { items: [item('p1')], hasMore: false, cursor: null } } })
    const result = await runCrawl(options(out, { type: 'creator', creators: ['u9'], keywords: [], comments: false }), { client })
    expect(calls).toEqual(['creator:u9', 'creatorItems:u9:null', 'detail:https://example.test/p1'])
    expect(result.counts).toMatchObject({ creators: 1, items: 1 })
  })

  it('aborts immediately on risk control instead of retrying', async () => {
    const out = await tempDir('omc-risk-')
    let attempts = 0
    const client = baseClient([], { async search() { attempts++; throw new CatbusError('RISK_CONTROL', 'captcha') } })
    await expect(runCrawl(options(out), { client })).rejects.toThrow('captcha')
    expect(attempts).toBe(1)
  })

  it('requires the selector that matches the type', async () => {
    const out = await tempDir('omc-usage-')
    await expect(runCrawl(options(out, { keywords: [] }), { client: baseClient([]) })).rejects.toThrow('--keywords')
  })
})

describe('storage round trips', () => {
  for (const format of ['json', 'jsonl', 'csv'] as const) {
    it(format, async () => {
      const out = await tempDir(`omc-${format}-`)
      const storage = await createStorage(format, out, 'xhs', 'search')
      await storage.write({ platform: 'xhs', kind: 'item', id: 'i1', data: item('i1') })
      await storage.write({ platform: 'xhs', kind: 'item', id: 'i2', data: { ...item('i2'), text: 'has "quotes", commas\nand newline' } })
      await storage.close()
      const path = storage.files()[0]!
      const records = await readStoredRecords(path)
      expect(records.map((r) => r.id)).toEqual(['i1', 'i2'])
      expect((records[1]!.data as Item).text).toBe('has "quotes", commas\nand newline')
      if (format === 'csv') expect((await readFile(path))[0]).toBe(0xef) // UTF-8 BOM for Excel
    })
  }

  it('sqlite upserts by (platform,id)', async () => {
    const out = await tempDir('omc-sqlite-')
    const storage = await createStorage('sqlite', out, 'xhs', 'search')
    await storage.write({ platform: 'xhs', kind: 'item', id: 'i1', data: item('i1') })
    await storage.write({ platform: 'xhs', kind: 'item', id: 'i1', data: { ...item('i1'), title: 'updated' } })
    await storage.write({ platform: 'xhs', kind: 'comment', id: 'c1', data: comment('c1') })
    await storage.close()
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (p: string) => { prepare(sql: string): { all(): Array<Record<string, unknown>> }; close(): void } }
    const db = new DatabaseSync(storage.files()[0]!)
    const items = db.prepare('SELECT id, data FROM items').all()
    expect(items).toHaveLength(1)
    expect(JSON.parse(String(items[0]!.data)).title).toBe('updated')
    expect(db.prepare('SELECT id FROM comments').all()).toHaveLength(1)
    db.close()
  })
})

describe('subprocess client (talks to the catbus CLI)', () => {
  async function fakeBin(dir: string, envelope: unknown, code = 0): Promise<string> {
    const path = join(dir, 'fake-catbus.mjs')
    await writeFile(path, `process.stdout.write(JSON.stringify({ ...${JSON.stringify(envelope)}, argv: process.argv.slice(2) })); process.exit(${code})`, 'utf8')
    return path
  }

  it('passes the cursor through and reads page.cursor / has_more from the envelope', async () => {
    const dir = await tempDir('omc-bin-')
    process.env.MEDIACRAWL_BIN = await fakeBin(dir, { ok: true, data: [item('z')], page: { cursor: 'next-1', has_more: true } })
    try {
      const page = await createSubprocessClient('xhs', { sort: 'latest' }).search('露营', 'abc')
      expect(page).toMatchObject({ cursor: 'next-1', hasMore: true })
      expect((page as { items: Item[] }).items[0]!.id).toBe('z')
    } finally { delete process.env.MEDIACRAWL_BIN }
  })

  it('maps catbus RISK_CONTROL errors so the job stops', async () => {
    const dir = await tempDir('omc-bin-')
    process.env.MEDIACRAWL_BIN = await fakeBin(dir, { ok: false, data: null, error: { code: 'RISK_CONTROL', message: 'slider captcha' } }, 6)
    try {
      await expect(createSubprocessClient('douyin').detail('1')).rejects.toMatchObject({ code: 'RISK_CONTROL' })
    } finally { delete process.env.MEDIACRAWL_BIN }
  })
})

describe('config, nag line, wordcloud', () => {
  it('CLI flags override the config file', async () => {
    const dir = await tempDir('omc-config-')
    const file = join(dir, 'crawl.yaml')
    await writeFile(file, 'platform: xhs\ntype: search\nmax-items: 7\ncomments: true\nsort: latest # comment\n', 'utf8')
    const result = await mergeCrawlConfig(file, { maxItems: '2', comments: false })
    expect(result).toMatchObject({ platform: 'xhs', type: 'search', maxItems: 2, comments: false, sort: 'latest' })
  })

  it('star line can be suppressed', () => {
    expect(shouldNag(false, undefined)).toBe(true)
    expect(shouldNag(false, '1')).toBe(false)
    expect(shouldNag(true, undefined)).toBe(false)
  })

  it('tokenizes Chinese text and renders a PNG word cloud', async () => {
    expect(tokenize('露营装备很好用 camping')).toEqual(expect.arrayContaining(['露营', '装备', 'camping']))
    const dir = await tempDir('omc-wc-')
    const input = join(dir, 'comments.jsonl')
    await writeFile(input, [comment('a'), comment('b'), comment('c')].map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8')
    const result = await generateWordCloud(input, join(dir, 'cloud.png'))
    expect(result.words).toBeGreaterThan(0)
    const png = await readFile(join(dir, 'cloud.png'))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  })
})

describe('web UI', () => {
  it('serves the page, runs a job, streams SSE and rejects bad input / path traversal', async () => {
    const out = await tempDir('omc-ui-')
    const ui = await startUiServer({ port: 0, out, clientFactory: () => baseClient([]) })
    const base = `http://${ui.host}:${ui.port}`
    try {
      const page = await fetch(base)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('github.com/Tommyapi/OpenMediaCrawl')
      expect((await fetch(`${base}/api/jobs`, { method: 'POST', body: '{bad' })).status).toBe(400)
      expect((await fetch(`${base}/api/jobs`, { method: 'POST', body: JSON.stringify({ platform: 'nope', type: 'search' }) })).status).toBe(400)
      const response = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 1, sleep: '0' }) })
      expect(response.status).toBe(202)
      const { id } = await response.json() as { id: string }
      const sse = await fetch(`${base}/api/jobs/${id}/events`)
      expect(sse.headers.get('content-type')).toContain('text/event-stream')
      const text = await sse.text() // stream ends when the job finishes
      expect(text).toContain('crawl finished')
      const jobs = await (await fetch(`${base}/api/jobs`)).json() as Array<{ id: string; status: string; result: { files: string[] } }>
      const job = jobs.find((j) => j.id === id)!
      expect(job.status).toBe('done')
      expect((await fetch(`${base}/api/files?path=${encodeURIComponent(job.result.files[0]!)}`)).status).toBe(200)
      expect((await fetch(`${base}/api/files?path=${encodeURIComponent(join(out, '..', 'secret.txt'))}`)).status).toBe(403)
    } finally { await ui.close() }
  })
})
