import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Comment, Item, User } from '../src/core/schemas.js'
import { CatbusError } from '../src/core/errors.js'
import { mergeCrawlConfig, normalizeCrawlOptions } from '../src/crawl/config.js'
import { runCrawl } from '../src/crawl/job.js'
import { loadIndex, resetRecordCache, threadOf } from '../src/crawl/records.js'
import { openContentStore } from '../src/crawl/shared/store.js'
import { createStorage, readStoredRecords } from '../src/crawl/storage.js'
import { shouldNag } from '../src/crawl/cli.js'
import { createSubprocessClient } from '../src/crawl/client.js'
import { startUiServer } from '../src/crawl/ui.js'
import { generateWordCloud, tokenize } from '../src/crawl/wordcloud.js'
import { LeadStore, buildLeads, type Lead } from '../src/crawl/leads.js'
import { SendLedger } from '../src/crawl/guard.js'
import { addCandidate, addCandidates, listCandidates } from '../src/crawl/candidates.js'
import type { CrawlOptions, CrawlPlatform, CrawlPlatformClient } from '../src/crawl/types.js'

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
const removeDir = async (dir: string): Promise<void> => {
  // macOS 上后台群发可能还在写；直接 rm 偶发 ENOTEMPTY，重试几次再放弃。
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); return } catch (error) {
      if (attempt === 5) throw error
      await new Promise((done) => setTimeout(done, 100 * (attempt + 1)))
    }
  }
}
afterEach(async () => { for (const d of tmp.splice(0)) await removeDir(d) })

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

  it('resumes an interrupted search from the saved cursor, not from page 1', async () => {
    const out = await tempDir('omc-resume-')
    const pages: Record<string, { items: Item[]; hasMore: boolean; cursor: string | null }> = {
      null: { items: [item('a'), item('b')], hasMore: true, cursor: 'tok-2' },
      'tok-2': { items: [item('c')], hasMore: true, cursor: 'tok-3' },
      'tok-3': { items: [item('d')], hasMore: false, cursor: null },
    }
    const calls: string[] = []
    let down = true
    const client = baseClient(calls, {
      async search(_keyword, cursor) {
        calls.push(`search:${cursor}`)
        if (cursor === 'tok-3' && down) throw new CatbusError('UPSTREAM', 'network down')
        return pages[String(cursor)]!
      },
    })
    await expect(runCrawl(options(out, { maxItems: 10, comments: false }), { client })).rejects.toThrow('network down')
    expect(calls[0]).toBe('search:null')
    expect(calls).toContain('search:tok-2')
    calls.length = 0
    down = false
    const second = await runCrawl(options(out, { maxItems: 10, comments: false }), { client })
    expect(calls[0]).toBe('search:tok-3')
    expect(calls.some((call) => call === 'search:null')).toBe(false)
    expect(second.counts).toMatchObject({ items: 1, skipped: 0 })
  })

  it('skips a keyword that already finished before the interruption', async () => {
    const out = await tempDir('omc-keywords-')
    const calls: string[] = []
    let down = true
    const client = baseClient(calls, {
      async search(keyword) {
        calls.push(`search:${keyword}`)
        if (keyword === 'b' && down) throw new CatbusError('UPSTREAM', 'network down')
        return { items: [item(`${keyword}1`)], hasMore: false, cursor: null }
      },
    })
    await expect(runCrawl(options(out, { keywords: ['a', 'b'], comments: false }), { client })).rejects.toThrow('network down')
    calls.length = 0
    down = false
    const second = await runCrawl(options(out, { keywords: ['a', 'b'], comments: false }), { client })
    expect(calls.filter((call) => call.startsWith('search:'))).toEqual(['search:b'])
    expect(second.counts.items).toBe(1)
  })

  it('a run that finished does not block the next run from re-querying the same keyword', async () => {
    const out = await tempDir('omc-rerun-')
    const calls: string[] = []
    const client = baseClient(calls)
    await runCrawl(options(out, { comments: false }), { client })
    calls.length = 0
    await runCrawl(options(out, { comments: false }), { client })
    expect(calls[0]).toBe('search:k:null')
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

describe('comments always land somewhere readable', () => {
  const itemOf = (id: string): Item => item(id)
  const cmt = (id: string, itemId: string, replies: number | null = null, parentId: string | null = null): Comment =>
    ({ id, item_id: itemId, parent_id: parentId, author: null, text: `评论 ${id}`, created_at: null, stats: { likes: null, replies } })
  /** 2 个作品、9 条评论，其中 2 条是二级（a1 下面两条）。 */
  const nineComments = (ref: string) => ref.endsWith('i1')
    ? [cmt('a1', 'i1', 2), cmt('a2', 'i1', 0), cmt('a3', 'i1', 0), cmt('a4', 'i1', 0)]
    : [cmt('b1', 'i2', 0), cmt('b2', 'i2', 0), cmt('b3', 'i2', 0)]
  const twoItems = (): CrawlPlatformClient => ({
    async search() { return { items: [itemOf('i1'), itemOf('i2')], hasMore: false, cursor: null } },
    async detail(id) { return itemOf(id.replace('https://example.test/', '')) },
    async comments(ref) { return nineComments(ref) },
    async subComments(_ref, cid) { return [cmt(`${cid}-r1`, 'i1', null, cid), cmt(`${cid}-r2`, 'i1', null, cid)] },
    async creator(id) { return user(id) },
    async creatorItems() { return [] },
    async download() { return 0 },
  })

  it('legacy mode writes the comment file and loadIndex reads all 9 back', async () => {
    const out = await tempDir('omc-cm-file-')
    const result = await runCrawl(options(out, { maxItems: 5, maxComments: 50 }), { client: twoItems() })
    expect(result.counts).toMatchObject({ items: 2, comments: 9 })
    expect(result.commentsUnsupported).toBeUndefined()
    const files = await readdir(join(out, 'xhs'))
    expect(files.sort()).toEqual([`search_comment_${new Date().toISOString().slice(0, 10)}.jsonl`, `search_item_${new Date().toISOString().slice(0, 10)}.jsonl`])

    resetRecordCache()
    const index = await loadIndex(out, 'xhs')
    expect(index.items.map((one) => one.id).sort()).toEqual(['i1', 'i2'])
    expect(index.items.find((one) => one.id === 'i1')!.comments).toBe(6)
    expect(index.comments.get('i1')!.length).toBe(6)
    expect(index.comments.get('i2')!.length).toBe(3)
    const thread = threadOf(index.comments.get('i1')!)
    expect(thread.map((one) => one.id)).toEqual(['a1', 'a2', 'a3', 'a4'])
    expect(thread[0]!.children.map((one) => one.id)).toEqual(['a1-r1', 'a1-r2'])
    expect(thread.flatMap((one) => [one.id, ...one.children.map((kid) => kid.id)])).toHaveLength(6)
  })

  it('shared mode keeps the same 9 comments readable without a per-user comment file', async () => {
    const base = await tempDir('omc-cm-shared-')
    const out = join(base, 'users', 'admin')
    const store = openContentStore(join(base, 'shared'))
    try {
      const result = await runCrawl(options(out, { maxItems: 5, maxComments: 50 }), { client: twoItems(), content: store, user: 'admin', jobId: 'job-1' })
      expect(result.counts).toMatchObject({ items: 2, comments: 9, newComments: 9 })
      // 共享模式下用户目录只有作品记录（评论在 content.sqlite 里），这就是「有时没有 comment 文件」的由来。
      expect((await readdir(join(out, 'xhs'))).filter((name) => name.includes('comment'))).toEqual([])
      expect(store.commentCount('xhs', 'i1')).toBe(6)
      expect(store.commentCount('xhs', 'i2')).toBe(3)

      resetRecordCache()
      const index = await loadIndex({ root: out, store, user: 'admin' }, 'xhs')
      expect(index.items).toHaveLength(2)
      expect(index.comments.get('i1')!.length).toBe(6)
      expect(index.comments.get('i2')!.length).toBe(3)
      const thread = threadOf(index.comments.get('i1')!)
      expect(thread.map((one) => one.id)).toEqual(['a1', 'a2', 'a3', 'a4'])
      expect(thread[0]!.children.map((one) => one.id)).toEqual(['a1-r1', 'a1-r2'])
    } finally { store.close() }
  })

  it('shared comments are still visible when the ref is missing (old import / CLI with another user)', async () => {
    const base = await tempDir('omc-cm-noref-')
    const out = join(base, 'users', 'admin')
    const store = openContentStore(join(base, 'shared'))
    try {
      // 库里只有内容：没有 addRef（旧数据迁移、CLI 忘了设 OMC_USER 都会这样）。
      store.putItem('xhs', itemOf('i1'), { body: 'full' })
      store.putComments('xhs', 'i1', [cmt('a1', 'i1', 1), cmt('a2', 'i1', 0), cmt('a1-r1', 'i1', null, 'a1')], { limit: 20, complete: false })
      await mkdir(join(out, 'xhs'), { recursive: true })
      await writeFile(join(out, 'xhs', 'search_item_2026-11-17.jsonl'), `${JSON.stringify({ id: 'i1', kind: 'text', url: 'https://example.test/i1', title: 'i1', shared: true })}\n`, 'utf8')

      resetRecordCache()
      const index = await loadIndex({ root: out, store, user: 'admin' }, 'xhs')
      expect(index.items.map((one) => one.id)).toEqual(['i1'])
      expect(index.comments.get('i1')?.map((one) => one.id)).toEqual(['a1', 'a2', 'a1-r1'])
      expect(threadOf(index.comments.get('i1')!)[0]!.children.map((one) => one.id)).toEqual(['a1-r1'])
    } finally { store.close() }
  })

  it('threadOf keeps comments whose parent is a platform sentinel or is not in the batch', () => {
    const list: Comment[] = [
      { ...cmt('c0', 'i1'), parent_id: '0' },          // 抖音式「没有父评论」
      { ...cmt('c1', 'i1'), parent_id: 'i1' },         // 父指针指向作品本身
      { ...cmt('c2', 'i1'), parent_id: 'c2' },         // 指向自己
      { ...cmt('c3', 'i1'), parent_id: 'gone' },       // 父评论没采到
      { ...cmt('c4', 'i1'), parent_id: 'c0' },         // 真的二级
    ]
    const thread = threadOf(list)
    expect(thread.map((one) => one.id)).toEqual(['c0', 'c1', 'c2', 'c3'])
    expect(thread[0]!.children.map((one) => one.id)).toEqual(['c4'])
  })

  it('默认把一级评论采全（maxComments=0）', () => {
    expect(normalizeCrawlOptions({ platform: 'xhs', type: 'detail', ids: ['i1'] }).maxComments).toBe(0)
    expect(normalizeCrawlOptions({ platform: 'xhs', type: 'search', keywords: ['k'], maxComments: 20 }).maxComments).toBe(20)
  })

  it('marks commentsUnsupported instead of failing the job when the platform has no comment list', async () => {
    const out = await tempDir('omc-cm-unsupported-')
    const events: string[] = []
    let attempts = 0
    const client = twoItems()
    client.comments = async () => { attempts++; throw new CatbusError('UNSUPPORTED', 'taobao 不支持 comment list') }
    const result = await runCrawl(options(out, { platform: 'taobao' as CrawlPlatform, maxItems: 5 }), {
      client,
      onEvent: (event) => events.push(event.message),
    })
    expect(result.commentsUnsupported).toBe(true)
    expect(result.counts).toMatchObject({ items: 2, comments: 0 })
    expect(attempts).toBe(1) // 确认不支持就不再逐条作品重试
    expect(events.some((message) => message.includes('暂不支持评论采集'))).toBe(true)
    expect(await readdir(join(out, 'taobao'))).toHaveLength(1) // 作品照常落盘
  })
})

describe('web UI', () => {
  const savedEnv = {
    users: process.env.OMC_USERS_FILE,
    password: process.env.OMC_ADMIN_PASSWORD,
    bin: process.env.MEDIACRAWL_BIN,
    maxJobsPerUser: process.env.OMC_MAX_JOBS_PER_USER,
    maxJobsGlobal: process.env.OMC_MAX_JOBS_GLOBAL,
    jobTtl: process.env.OMC_JOB_TTL_MS,
    campaignTtl: process.env.OMC_CAMPAIGN_TTL_MS,
  }
  afterEach(() => {
    if (savedEnv.users === undefined) delete process.env.OMC_USERS_FILE; else process.env.OMC_USERS_FILE = savedEnv.users
    if (savedEnv.password === undefined) delete process.env.OMC_ADMIN_PASSWORD; else process.env.OMC_ADMIN_PASSWORD = savedEnv.password
    if (savedEnv.bin === undefined) delete process.env.MEDIACRAWL_BIN; else process.env.MEDIACRAWL_BIN = savedEnv.bin
    if (savedEnv.maxJobsPerUser === undefined) delete process.env.OMC_MAX_JOBS_PER_USER; else process.env.OMC_MAX_JOBS_PER_USER = savedEnv.maxJobsPerUser
    if (savedEnv.maxJobsGlobal === undefined) delete process.env.OMC_MAX_JOBS_GLOBAL; else process.env.OMC_MAX_JOBS_GLOBAL = savedEnv.maxJobsGlobal
    if (savedEnv.jobTtl === undefined) delete process.env.OMC_JOB_TTL_MS; else process.env.OMC_JOB_TTL_MS = savedEnv.jobTtl
    if (savedEnv.campaignTtl === undefined) delete process.env.OMC_CAMPAIGN_TTL_MS; else process.env.OMC_CAMPAIGN_TTL_MS = savedEnv.campaignTtl
  })

  async function uiServer(prefix: string, clientFactory?: (platform: any, extra: any) => any) {
    const out = await tempDir(prefix)
    const home = await tempDir(`${prefix}home-`)
    process.env.OMC_USERS_FILE = join(home, 'users.json')
    process.env.OMC_ADMIN_PASSWORD = 'adminpass123'
    const ui = await startUiServer({ port: 0, out, clientFactory: clientFactory ?? (() => baseClient([])) })
    return { out, ui, base: `http://${ui.host}:${ui.port}` }
  }

  async function signIn(base: string, username = 'admin', password = 'adminpass123'): Promise<string> {
    const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    expect(response.status).toBe(200)
    return response.headers.get('set-cookie')!.split(';')[0]!
  }

  async function addUser(base: string, adminCookie: string, username: string, password = 'password123'): Promise<void> {
    const response = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ username, password }),
    })
    expect(response.status).toBe(201)
  }

  /** 等所有采集任务离开 running（测试收尾用，避免 server.close 后还有异步写入）。 */
  async function waitForIdleJobs(base: string, cookie: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const list = await (await fetch(`${base}/api/jobs`, { headers: { cookie } })).json() as Array<{ status: string }>
      if (list.every((job) => job.status !== 'running')) return
      await new Promise((done) => setTimeout(done, 25))
    }
    throw new Error('jobs did not finish in time')
  }

  it('requires a login, runs a job for that user, streams SSE and rejects bad input / path traversal', async () => {
    const { out, ui, base } = await uiServer('omc-ui-')
    try {
      const page = await fetch(base)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('github.com/Tommyapi/OpenMediaCrawl')
      expect((await fetch(`${base}/api/jobs`)).status).toBe(401)
      expect((await fetch(`${base}/api/accounts?platform=xhs`)).status).toBe(401)
      const cookie = await signIn(base)
      const auth = { cookie }
      expect((await fetch(`${base}/api/jobs`, { method: 'POST', headers: auth, body: '{bad' })).status).toBe(400)
      expect((await fetch(`${base}/api/jobs`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'nope', type: 'search' }) })).status).toBe(400)
      const response = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 1, sleep: '0' }) })
      expect(response.status).toBe(202)
      const { id } = await response.json() as { id: string }
      const sse = await fetch(`${base}/api/jobs/${id}/events`, { headers: auth })
      expect(sse.headers.get('content-type')).toContain('text/event-stream')
      const text = await sse.text() // stream ends when the job finishes
      expect(text).toContain('crawl finished')
      const jobs = await (await fetch(`${base}/api/jobs`, { headers: auth })).json() as Array<{ id: string; owner: string; status: string; result: { files: string[] } }>
      const job = jobs.find((j) => j.id === id)!
      expect(job.status).toBe('done')
      expect(job.owner).toBe('admin')
      expect(job.result.files[0]!.replace(/\\/g, '/')).toContain(`/users/admin/`)
      expect((await fetch(`${base}/api/files?path=${encodeURIComponent(job.result.files[0]!)}`, { headers: auth })).status).toBe(200)
      expect((await fetch(`${base}/api/files?path=${encodeURIComponent(join(out, '..', 'secret.txt'))}`, { headers: auth })).status).toBe(403)
      expect((await fetch(`${base}/api/logout`, { method: 'POST', headers: auth })).status).toBe(200)
      expect((await fetch(`${base}/api/jobs`, { headers: auth })).status).toBe(401)
    } finally { await ui.close() }
  })

  it('每用户同时只允许 1 个采集任务，超出返回 429', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const factory = (() => baseClient([], {
      async search() { await gate; return { items: [], hasMore: false, cursor: null } },
    })) as any
    const { ui, base } = await uiServer('omc-limit-user-', factory)
    try {
      const admin = await signIn(base)
      const adminAuth = { 'content-type': 'application/json', cookie: admin }
      await addUser(base, admin, 'bob')
      const bob = await signIn(base, 'bob', 'password123')
      const bobAuth = { 'content-type': 'application/json', cookie: bob }
      const body = JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 1, sleep: '0' })

      expect((await fetch(`${base}/api/jobs`, { method: 'POST', headers: adminAuth, body })).status).toBe(202)
      const blocked = await fetch(`${base}/api/jobs`, { method: 'POST', headers: adminAuth, body })
      expect(blocked.status).toBe(429)
      expect((await blocked.json() as { error: string }).error).toContain('每用户最多 1')

      // 另一个用户不受 admin 的并发占用影响。
      expect((await fetch(`${base}/api/jobs`, { method: 'POST', headers: bobAuth, body })).status).toBe(202)
    } finally {
      release()
      await waitForIdleJobs(base, await signIn(base))
      await ui.close()
    }
  })

  it('全局并发上限默认 4，可用 OMC_MAX_JOBS_GLOBAL 覆盖', async () => {
    process.env.OMC_MAX_JOBS_PER_USER = '4'
    process.env.OMC_MAX_JOBS_GLOBAL = '1'
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const factory = (() => baseClient([], {
      async search() { await gate; return { items: [], hasMore: false, cursor: null } },
    })) as any
    const { ui, base } = await uiServer('omc-limit-global-', factory)
    try {
      const admin = await signIn(base)
      const adminAuth = { 'content-type': 'application/json', cookie: admin }
      await addUser(base, admin, 'bob')
      const bob = await signIn(base, 'bob', 'password123')
      const bobAuth = { 'content-type': 'application/json', cookie: bob }
      const body = JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 1, sleep: '0' })

      expect((await fetch(`${base}/api/jobs`, { method: 'POST', headers: adminAuth, body })).status).toBe(202)
      const blocked = await fetch(`${base}/api/jobs`, { method: 'POST', headers: bobAuth, body })
      expect(blocked.status).toBe(429)
      expect((await blocked.json() as { error: string }).error).toContain('服务器同时最多 1')
    } finally {
      release()
      await waitForIdleJobs(base, await signIn(base))
      await ui.close()
    }
  })

  it('完成的采集任务过 TTL 后从内存移除', async () => {
    process.env.OMC_JOB_TTL_MS = '50'
    const { ui, base } = await uiServer('omc-job-ttl-')
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      const started = await fetch(`${base}/api/jobs`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 1, sleep: '0' }),
      })
      expect(started.status).toBe(202)
      const { id } = await started.json() as { id: string }
      await waitForIdleJobs(base, cookie)
      await new Promise((done) => setTimeout(done, 250))
      const list = await (await fetch(`${base}/api/jobs`, { headers: { cookie } })).json() as Array<{ id: string }>
      expect(list.some((job) => job.id === id)).toBe(false)
    } finally { await ui.close() }
  })

  it('群发只允许 owner 查看 / 停止 / 订阅，admin 也不能跨用户', async () => {
    const binDir = await tempDir('omc-bin-camp-owner-')
    const bin = join(binDir, 'fake-action.mjs')
    await writeFile(bin, 'process.stdout.write(JSON.stringify({ ok: true, data: { id: "x" } }) + String.fromCharCode(10)); process.exit(0)', 'utf8')
    process.env.MEDIACRAWL_BIN = bin
    const { ui, base } = await uiServer('omc-camp-owner-')
    try {
      const admin = await signIn(base)
      const adminAuth = { 'content-type': 'application/json', cookie: admin }
      await addUser(base, admin, 'bob')
      const bob = await signIn(base, 'bob', 'password123')
      const bobAuth = { 'content-type': 'application/json', cookie: bob }
      const candidate = (type: 'reply' | 'dm') => JSON.stringify({
        type, platform: 'douyin', itemId: 'i1', commentId: 'c1', userId: 'u1', userName: '张三',
      })

      expect((await fetch(`${base}/api/candidates`, { method: 'POST', headers: adminAuth, body: candidate('reply') })).status).toBe(201)
      const adminCampaign = await fetch(`${base}/api/campaigns`, {
        method: 'POST', headers: adminAuth, body: JSON.stringify({ type: 'reply', text: '收到', minSeconds: 5, maxSeconds: 5 }),
      })
      expect(adminCampaign.status).toBe(202)
      const adminId = (await adminCampaign.json() as { id: string }).id
      expect((await fetch(`${base}/api/campaigns/${adminId}`, { headers: { cookie: bob } })).status).toBe(404)
      expect((await fetch(`${base}/api/campaigns/${adminId}/events`, { headers: { cookie: bob } })).status).toBe(404)
      expect((await fetch(`${base}/api/campaigns/${adminId}/stop`, { method: 'POST', headers: { cookie: bob } })).status).toBe(404)
      expect((await fetch(`${base}/api/campaigns/${adminId}`, { headers: { cookie: admin } })).status).toBe(200)

      // 反向也成立：admin 看不到 bob 的群发。
      expect((await fetch(`${base}/api/candidates`, { method: 'POST', headers: bobAuth, body: candidate('dm') })).status).toBe(201)
      const bobCampaign = await fetch(`${base}/api/campaigns`, {
        method: 'POST', headers: bobAuth, body: JSON.stringify({ type: 'dm', text: '你好', minSeconds: 5, maxSeconds: 5 }),
      })
      expect(bobCampaign.status).toBe(202)
      const bobId = (await bobCampaign.json() as { id: string }).id
      expect((await fetch(`${base}/api/campaigns/${bobId}`, { headers: { cookie: admin } })).status).toBe(404)
      expect((await fetch(`${base}/api/campaigns/${bobId}`, { headers: { cookie: bob } })).status).toBe(200)
    } finally { await ui.close() }
  })

  it('完成的群发过 TTL 后移除，SSE 订阅者自动结束', async () => {
    process.env.OMC_CAMPAIGN_TTL_MS = '100'
    const binDir = await tempDir('omc-bin-camp-ttl-')
    const bin = join(binDir, 'slow-action.mjs')
    await writeFile(bin, 'setTimeout(() => { process.stdout.write(JSON.stringify({ ok: true, data: { id: "x" } }) + String.fromCharCode(10)); process.exit(0) }, 80)', 'utf8')
    process.env.MEDIACRAWL_BIN = bin
    const { ui, base } = await uiServer('omc-camp-ttl-')
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      expect((await fetch(`${base}/api/candidates`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ type: 'dm', platform: 'douyin', itemId: 'manual', userId: 'https://www.douyin.com/user/x' }),
      })).status).toBe(201)
      const started = await fetch(`${base}/api/campaigns`, {
        method: 'POST', headers: auth, body: JSON.stringify({ type: 'dm', text: '你好', minSeconds: 5, maxSeconds: 5 }),
      })
      expect(started.status).toBe(202)
      const { id } = await started.json() as { id: string }
      const text = await (await fetch(`${base}/api/campaigns/${id}/events`, { headers: { cookie } })).text()
      expect(text).toContain('"type":"done"')
      await new Promise((done) => setTimeout(done, 300))
      expect((await fetch(`${base}/api/campaigns/${id}`, { headers: { cookie } })).status).toBe(404)
    } finally { await ui.close() }
  })

  it('drives QR login through the CLI and lists / switches accounts per user', async () => {
    const binDir = await tempDir('omc-bin-login-')
    const bin = join(binDir, 'fake-login.mjs')
    await writeFile(bin, [
      "import { mkdirSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "const platform = process.argv[2]",
      "const cache = join(process.env.CATBUS_HOME, 'cache', platform)",
      "mkdirSync(cache, { recursive: true })",
      "writeFileSync(join(cache, 'qrcode.png'), Buffer.from('89504e470d0a1a0a', 'hex'))",
      "const auth = join(process.env.CATBUS_HOME, 'auth', platform, 'web')",
      "mkdirSync(auth, { recursive: true })",
      "writeFileSync(join(auth, 'default.json'), JSON.stringify({ platform, endpoint: 'web', account: 'default', method: 'qrcode', updated_at: new Date().toISOString(), scopes: {}, user: null }))",
    ].join('\n'), 'utf8')
    process.env.MEDIACRAWL_BIN = bin
    const { ui, base } = await uiServer('omc-ui-login-')
    try {
      const cookie = await signIn(base)
      const auth = { cookie }
      const platforms = await (await fetch(`${base}/api/platforms`, { headers: auth })).json() as Array<{ id: string }>
      expect(platforms.some((p) => p.id === 'xhs')).toBe(true)
      const started = await fetch(`${base}/api/login/start`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ platform: 'xhs' }) })
      expect(started.status).toBe(202)
      const { id } = await started.json() as { id: string }
      let status = { status: 'pending', qr: null as number | null }
      for (let i = 0; i < 40 && status.status === 'pending'; i++) {
        await new Promise((done) => setTimeout(done, 100))
        status = await (await fetch(`${base}/api/login/${id}`, { headers: auth })).json() as typeof status
      }
      expect(status.status).toBe('ok')
      expect(status.qr).toBeGreaterThan(0)
      const qr = await fetch(`${base}/api/qrcode?platform=xhs`, { headers: auth })
      expect(qr.headers.get('content-type')).toBe('image/png')
      expect((await qr.arrayBuffer()).byteLength).toBe(8)
      const accounts = await (await fetch(`${base}/api/accounts?platform=xhs`, { headers: auth })).json() as { accounts: Array<{ account: string; current: boolean }> }
      expect(accounts.accounts.map((a) => a.account)).toEqual(['default'])
      expect((await fetch(`${base}/api/accounts/use`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'xhs', account: 'default' }) })).status).toBe(200)
      const after = await (await fetch(`${base}/api/accounts?platform=xhs`, { headers: auth })).json() as { accounts: Array<{ current: boolean }> }
      expect(after.accounts[0]!.current).toBe(true)
      expect((await fetch(`${base}/api/login/start`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'nope' }) })).status).toBe(400)
    } finally { await ui.close() }
  })

  it('turns a failed QR login into a readable reason instead of printing the QR art', async () => {
    const binDir = await tempDir('omc-bin-fail-')
    const bin = join(binDir, 'fake-fail.mjs')
    await writeFile(bin, [
      "process.stderr.write('\\u001b[47m\\u001b[30m▀▀▀▀▀▀\\u001b[0m\\n')",
      "process.stdout.write(JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', message: '登录超时', hint: '重新执行登录命令' } }) + '\\n')",
      'process.exit(5)',
    ].join('\n'), 'utf8')
    process.env.MEDIACRAWL_BIN = bin
    const { ui, base } = await uiServer('omc-ui-fail-')
    try {
      const cookie = await signIn(base)
      const started = await fetch(`${base}/api/login/start`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ platform: 'xhs' }) })
      const { id } = await started.json() as { id: string }
      let status = { status: 'pending', message: '' }
      for (let i = 0; i < 40 && status.status === 'pending'; i++) {
        await new Promise((done) => setTimeout(done, 100))
        status = await (await fetch(`${base}/api/login/${id}`, { headers: { cookie } })).json() as typeof status
      }
      expect(status.status).toBe('error')
      expect(status.message).toContain('有效期内')
      expect(status.message).not.toContain('▀')
    } finally { await ui.close() }
  })

  it('isolates users: admin sees everything, a normal user sees only their own data', async () => {
    const { out, ui, base } = await uiServer('omc-ui-iso-')
    try {
      const admin = await signIn(base)
      const auth = { cookie: admin }
      expect((await fetch(`${base}/api/users`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ username: 'bob', password: 'bobpass123', role: 'user' }) })).status).toBe(201)
      const response = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 1, sleep: '0' }) })
      const { id } = await response.json() as { id: string }
      await (await fetch(`${base}/api/jobs/${id}/events`, { headers: auth })).text()
      const job = (await (await fetch(`${base}/api/jobs`, { headers: auth })).json() as Array<{ id: string; result: { files: string[] } }>).find((j) => j.id === id)!
      const bob = await signIn(base, 'bob', 'bobpass123')
      const bobAuth = { cookie: bob }
      expect((await (await fetch(`${base}/api/jobs`, { headers: bobAuth })).json() as unknown[])).toHaveLength(0)
      expect((await fetch(`${base}/api/users`, { headers: bobAuth })).status).toBe(403)
      expect((await fetch(`${base}/api/files?path=${encodeURIComponent(job.result.files[0]!)}`, { headers: bobAuth })).status).toBe(403)
      expect((await fetch(`${base}/api/files?path=${encodeURIComponent(job.result.files[0]!)}&user=admin`, { headers: bobAuth })).status).toBe(403)
      expect((await fetch(`${base}/api/files?path=${encodeURIComponent(job.result.files[0]!)}`, { headers: auth })).status).toBe(200)
      expect((await fetch(`${base}/api/users`, { headers: auth })).status).toBe(200)
      expect(join(out, 'users', 'bob')).toBeTruthy()
    } finally { await ui.close() }
  })

  it('reports the scanned stage and serves a per-login QR snapshot', async () => {
    const binDir = await tempDir('omc-bin-stage-')
    const bin = join(binDir, 'fake-stage.mjs')
    await writeFile(bin, [
      "import { mkdirSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "const platform = process.argv[2]",
      "const dir = join(process.env.CATBUS_HOME, 'cache', platform)",
      "mkdirSync(dir, { recursive: true })",
      "writeFileSync(join(dir, 'qrcode.png'), Buffer.from('89504e470d0a1a0a', 'hex'))",
      "process.stderr.write('请用 App 扫码并确认\\n')",
      "setTimeout(() => { process.stderr.write('已扫码，请在手机上确认\\n'); setTimeout(() => process.exit(0), 1200) }, 200)",
    ].join('\n'), 'utf8')
    process.env.MEDIACRAWL_BIN = bin
    const { ui, base } = await uiServer('omc-ui-stage-')
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      const started = await fetch(`${base}/api/login/start`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'douyin' }) })
      expect(started.status).toBe(202)
      const { id } = await started.json() as { id: string }
      const reused = await fetch(`${base}/api/login/start`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'douyin' }) })
      expect(reused.status).toBe(200)
      expect((await reused.json() as { id: string; reused: boolean }).id).toBe(id)
      await new Promise((done) => setTimeout(done, 700))
      const mid = await (await fetch(`${base}/api/login/${id}`, { headers: { cookie } })).json() as { stage: string; message: string; qr: number | null; status: string }
      expect(mid.status).toBe('pending')
      expect(mid.stage).toBe('scanned')
      expect(mid.message).toContain('已扫码')
      expect(mid.qr).toBeGreaterThan(0)
      const qr = await fetch(`${base}/api/qrcode?login=${id}`, { headers: { cookie } })
      expect(qr.headers.get('content-type')).toBe('image/png')
      expect((await qr.arrayBuffer()).byteLength).toBe(8)
      let final = mid as { status: string }
      for (let i = 0; i < 40 && final.status === 'pending'; i++) {
        await new Promise((done) => setTimeout(done, 100))
        final = await (await fetch(`${base}/api/login/${id}`, { headers: { cookie } })).json() as typeof final
      }
      expect(final.status).toBe('ok')
    } finally { await ui.close() }
  })

  it('serves stored records, comments and runs a candidate campaign', async () => {
    const { out, ui, base } = await uiServer('omc-ui-work-')
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      const dir = join(out, 'users', 'admin', 'douyin')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'search_item_2026-11-12.jsonl'), JSON.stringify({ id: 'i1', kind: 'video', title: '作品一', text: '', url: 'https://www.douyin.com/video/i1', cover: null, author: { id: 'a1', name: '作者' }, created_at: null, stats: { views: 1, likes: 2, comments: 3, collects: 4, shares: 5 } }) + '\n', 'utf8')
      await writeFile(join(dir, 'search_comment_2026-11-12.jsonl'), [
        { id: 'c1', item_id: 'i1', parent_id: null, author: { id: 'u1', name: '张三', url: null }, text: '一级评论', created_at: '2026-11-12T10:00:00+08:00', stats: { likes: 1, replies: 1 } },
        { id: 'c2', item_id: 'i1', parent_id: 'c1', author: { id: 'u2', name: '李四', url: null }, text: '二级回复', created_at: '2026-11-12T11:00:00+08:00', stats: { likes: 0, replies: 0 } },
      ].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')

      const records = await (await fetch(`${base}/api/records?platform=douyin`, { headers: { cookie } })).json() as { items: Array<{ id: string; comments: number }> }
      expect(records.items).toHaveLength(1)
      expect(records.items[0]).toMatchObject({ id: 'i1', comments: 2 })
      const comments = await (await fetch(`${base}/api/records/comments?platform=douyin&item=i1`, { headers: { cookie } })).json() as { comments: Array<{ id: string; children: Array<{ id: string }> }> }
      expect(comments.comments).toHaveLength(1)
      expect(comments.comments[0]!.children.map((c) => c.id)).toEqual(['c2'])

      const added = await fetch(`${base}/api/candidates`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'reply', platform: 'douyin', itemId: 'i1', commentId: 'c1', userId: 'u1', userName: '张三' }) })
      expect(added.status).toBe(201)
      const listed = await (await fetch(`${base}/api/candidates`, { headers: { cookie } })).json() as { candidates: unknown[] }
      expect(listed.candidates).toHaveLength(1)

      const binDir = await tempDir('omc-bin-camp-')
      const bin = join(binDir, 'fake-action.mjs')
      await writeFile(bin, 'process.stdout.write(JSON.stringify({ ok: true, data: { id: "x" } }) + String.fromCharCode(10)); process.exit(0)', 'utf8')
      process.env.MEDIACRAWL_BIN = bin

      const campaign = await fetch(`${base}/api/campaigns`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'reply', text: '收到', minSeconds: 5, maxSeconds: 5 }) })
      expect(campaign.status).toBe(202)
      const { id } = await campaign.json() as { id: string; total: number }
      let state = { status: 'running', sent: 0 }
      for (let i = 0; i < 60 && state.status === 'running'; i++) {
        await new Promise((done) => setTimeout(done, 100))
        state = await (await fetch(`${base}/api/campaigns/${id}`, { headers: { cookie } })).json() as typeof state
      }
      expect(state.status).toBe('done')
      expect(state.sent).toBe(1)
    } finally { await ui.close() }
  })

  it('builds leads from stored comments and exports a BOM CSV', async () => {
    const { out, ui, base } = await uiServer('omc-ui-leads-')
    try {
      const cookie = await signIn(base)
      const auth = { cookie }
      const dir = join(out, 'users', 'admin', 'douyin')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'a.jsonl'), [
        JSON.stringify({ id: 'i1', kind: 'video', title: '作品一', url: 'https://x/i1', stats: { likes: 1, comments: 2 } }),
        JSON.stringify({ id: 'c1', item_id: 'i1', parent_id: null, author: { id: 'u1', name: '张三' }, text: '多少钱？加我微信 abc_123', created_at: '2026-11-12T10:00:00+08:00', stats: { likes: 0, replies: 0 } }),
        JSON.stringify({ id: 'c2', item_id: 'i1', parent_id: null, author: { id: 'u2', name: '李四' }, text: '路过看看', created_at: '2026-11-12T11:00:00+08:00', stats: { likes: 0, replies: 0 } }),
      ].join('\n') + '\n', 'utf8')

      // /api/leads/build 已删（UI 从不调用）：intent 过滤改为直接测 buildLeads，
      // 避免"为了一个死路由保留一整套 HTTP 分支"
      const rows = (await readFile(join(dir, 'a.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      const leadStore = new LeadStore(join(out, 'users', 'admin', 'leads.jsonl'))
      const builtLeads = buildLeads({
        platform: 'douyin',
        items: rows.filter((row) => row.kind === 'video') as never,
        comments: rows.filter((row) => row.kind !== 'video') as never,
        intent: ['多少钱', '怎么卖'],
      })
      expect(builtLeads).toHaveLength(1)
      expect(await leadStore.upsert(builtLeads)).toMatchObject({ added: 1 })

      const leads = await (await fetch(`${base}/api/leads?platform=douyin`, { headers: auth })).json() as { total: number; items: Array<{ id: string; contacts: Array<{ type: string; value: string }>; matched: string[] }> }
      expect(leads.total).toBe(1)
      expect(leads.items[0]!.matched).toEqual(['多少钱'])
      expect(leads.items[0]!.contacts[0]).toMatchObject({ type: 'wechat', value: 'abc_123' })

      // 勾选的线索可以直接进私信候选池（按用户去重）
      const pickedLeads = leads.items.map((lead) => lead.id)
      const toPool = await (await fetch(`${base}/api/leads/candidates`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ids: pickedLeads }) })).json() as { added: number; skipped: number; missing: number; total: number }
      expect(toPool).toMatchObject({ added: 1, skipped: 0, missing: 0, total: 1 })
      const pool = await (await fetch(`${base}/api/candidates`, { headers: { cookie } })).json() as { candidates: Array<{ type: string; platform: string; itemId: string; userId: string | null; commentId: string | null }> }
      expect(pool.candidates.find((one) => one.type === 'dm')).toMatchObject({ platform: 'douyin', itemId: 'i1', userId: 'u1', commentId: null })
      const again = await (await fetch(`${base}/api/leads/candidates`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ids: pickedLeads }) })).json() as { added: number; skipped: number }
      expect(again).toMatchObject({ added: 0, skipped: 1 })

      const csv = await fetch(`${base}/api/leads/export.csv?platform=douyin`, { headers: auth })
      expect(csv.status).toBe(200)
      const buffer = Buffer.from(await csv.arrayBuffer())
      expect([buffer[0], buffer[1], buffer[2]]).toEqual([0xef, 0xbb, 0xbf])
      expect(buffer.toString('utf8')).toContain('评论者')

      const leadId = (leads.items[0] as { id: string }).id
      const picked = await fetch(`${base}/api/leads/export.csv?ids=${encodeURIComponent(leadId)}`, { headers: auth })
      expect(picked.status).toBe(200)
      expect(picked.headers.get('content-type')).toContain('text/csv')
      expect((await picked.text()).trim().split('\r\n').length).toBe(2)
      expect((await fetch(`${base}/api/leads/export.csv?ids=nope`, { headers: auth })).status).toBe(400)

      const stats = await (await fetch(`${base}/api/leads/stats`, { headers: auth })).json() as { total: number; withContact: number; provinces: string[] }
      expect(stats).toMatchObject({ total: 1, withContact: 1 })


      const dash = await (await fetch(`${base}/api/dashboard`, { headers: auth })).json() as { total: number; contactHits: number }
      expect(dash.total).toBe(1)
      expect(dash.contactHits).toBe(1)

      // 自动同步不看意向词：两条评论都会成为线索
      const sync = await (await fetch(`${base}/api/leads/sync`, { method: 'POST', headers: auth })).json() as { built: number; added: number; total: number }
      expect(sync).toMatchObject({ built: 2, added: 1, total: 2 })

      const bulk = await (await fetch(`${base}/api/candidates/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'dm', platform: 'douyin', itemId: 'i1', items: [{ commentId: 'c1', userId: 'u1', userName: '张三' }, { commentId: 'c2', userId: 'u2' }] }),
      })).json() as { added: number; skipped: number }
      expect(bulk).toMatchObject({ added: 2, skipped: 0 })

      // 手动加自己的小号做收信测试：不绑定作品，itemId 用 manual
      const manual = await (await fetch(`${base}/api/candidates`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'dm', platform: 'douyin', itemId: 'manual', userId: 'https://www.douyin.com/user/MS4test', userName: '小号', note: '手动添加' }),
      })).json() as { added: boolean; candidate: { userId: string; note: string } }
      expect(manual.added).toBe(true)
      expect(manual.candidate).toMatchObject({ userId: 'https://www.douyin.com/user/MS4test', note: '手动添加' })
      const manualAgain = await (await fetch(`${base}/api/candidates`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'dm', platform: 'douyin', itemId: 'manual', userId: 'https://www.douyin.com/user/MS4test' }),
      })).json() as { added: boolean }
      expect(manualAgain.added).toBe(false)

      // 本机抓取工具：公开下载，bat 里带当前控制台的地址
      const tool = await fetch(`${base}/api/capture/dy-capture.mjs`)
      expect(tool.status).toBe(200)
      expect(await tool.text()).toContain('dy-capture')

      // 抓取脚本现在要登录才下发（bat 里带着一次性导入令牌，不能匿名拿）
      expect((await fetch(`${base}/api/capture/capture-douyin.bat`)).status).toBe(401)
      const bat = await fetch(`${base}/api/capture/capture-douyin.bat`, { headers: { cookie } })
      expect(bat.status).toBe(200)
      const batText = await bat.text()
      expect(batText).toContain('/api/capture/dy-capture.mjs')
      expect(batText).toContain('where node')

      // 群发话术：存多套、按 id 删
      const tpl0 = await (await fetch(`${base}/api/templates`, { headers: { cookie } })).json() as { items: unknown[] }
      expect(tpl0.items).toEqual([])
      const tplSave = await (await fetch(`${base}/api/templates`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: '宝妈-低价款', text: '宝妈看这里，39 元两件' }),
      })).json() as { created: boolean; template: { id: string; name: string; text: string } }
      expect(tplSave.created).toBe(true)
      const tplList = await (await fetch(`${base}/api/templates`, { headers: { cookie } })).json() as { items: Array<{ id: string; name: string; text: string }> }
      expect(tplList.items).toHaveLength(1)
      expect(tplList.items[0]).toMatchObject({ name: '宝妈-低价款', text: '宝妈看这里，39 元两件' })
      const tplDel = await (await fetch(`${base}/api/templates`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ action: 'delete', id: tplSave.template.id }),
      })).json() as { deleted: boolean }
      expect(tplDel.deleted).toBe(true)
      expect(((await (await fetch(`${base}/api/templates`, { headers: { cookie } })).json()) as { items: unknown[] }).items).toEqual([])
    } finally { await ui.close() }
  })

  it('线索关联已私聊 / 已入池状态，CSV 带私聊状态与时间，候选池也能看到已私聊', async () => {
    const { out, ui, base } = await uiServer('omc-lead-status-')
    try {
      const cookie = await signIn(base)
      const root = join(out, 'users', 'admin')
      await mkdir(root, { recursive: true })
      const oneLead = (id: string, author: string) => ({
        id: `douyin:${id}`, platform: 'douyin', comment_id: id, item_id: 'i1', item_title: '作品一', item_url: 'https://x/i1',
        author_id: author, author_name: author, text: '多少钱？', created_at: '2026-11-12T10:00:00+08:00', province: '广东',
        matched: [], contacts: [], collected_at: '2026-11-13T10:00:00+08:00',
      })
      await writeFile(join(root, 'leads.jsonl'), [oneLead('c1', 'u1'), oneLead('c2', 'u2'), oneLead('c3', 'u3')].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
      await writeFile(join(root, 'sent.jsonl'), [
        JSON.stringify({ platform: 'douyin', target: 'u1', kind: 'dm', at: '2026-11-14T09:00:00+08:00', ok: true }),
        // 失败的不算「已私聊」，可以重发
        JSON.stringify({ platform: 'douyin', target: 'u2', kind: 'dm', at: '2026-11-14T09:05:00+08:00', ok: false }),
        JSON.stringify({ platform: 'douyin', target: 'c3', kind: 'reply', at: '2026-11-14T09:10:00+08:00', ok: true }),
      ].join('\n') + '\n', 'utf8')
      await writeFile(join(root, 'candidates.json'), JSON.stringify({
        version: 1,
        items: [
          { id: 'k1', type: 'dm', platform: 'douyin', itemId: 'i1', commentId: null, userId: 'u1', userName: 'u1', note: null, added_at: '2026-11-13T10:00:00+08:00' },
          { id: 'k2', type: 'dm', platform: 'douyin', itemId: 'i1', commentId: null, userId: 'u2', userName: 'u2', note: null, added_at: '2026-11-13T10:00:00+08:00' },
        ],
      }), 'utf8')

      const listed = await (await fetch(`${base}/api/leads?platform=douyin`, { headers: { cookie } })).json() as {
        total: number
        items: Array<{ id: string; dm_sent_at?: string; in_pool?: boolean }>
      }
      expect(listed.total).toBe(3)
      const byId = new Map(listed.items.map((lead) => [lead.id, lead]))
      expect(byId.get('douyin:c1')).toMatchObject({ dm_sent_at: '2026-11-14T09:00:00+08:00', in_pool: true })
      expect(byId.get('douyin:c2')).toMatchObject({ in_pool: true })
      expect(byId.get('douyin:c2')!.dm_sent_at).toBeUndefined()
      expect(byId.get('douyin:c3')!.dm_sent_at).toBeUndefined()
      expect(byId.get('douyin:c3')!.in_pool).toBeUndefined()

      // 账本才是唯一真源：线索文件里不落这两个字段
      const rawLeads = await readFile(join(root, 'leads.jsonl'), 'utf8')
      expect(rawLeads).not.toContain('dm_sent_at')
      expect(rawLeads).not.toContain('in_pool')

      const csv = Buffer.from(await (await fetch(`${base}/api/leads/export.csv?platform=douyin`, { headers: { cookie } })).arrayBuffer()).toString('utf8')
      expect(csv.split('\r\n')[0]).toContain('私聊状态,私聊时间')
      expect(csv).toContain(',已私聊,2026-11-14T09:00:00+08:00')
      expect(csv.match(/,未私聊,/g)).toHaveLength(2)

      const pool = await (await fetch(`${base}/api/candidates`, { headers: { cookie } })).json() as {
        candidates: Array<{ id: string; dm_sent_at?: string }>
      }
      expect(pool.candidates.find((one) => one.id === 'k1')?.dm_sent_at).toBe('2026-11-14T09:00:00+08:00')
      expect(pool.candidates.find((one) => one.id === 'k2')?.dm_sent_at).toBeUndefined()
    } finally { await ui.close() }
  })

  it('检查新评论：没有新评论时明确返回 0，不写评论状态', async () => {
    const factory = (() => ({ comments: async () => ({ items: [], hasMore: false, cursor: null }) })) as any
    const { ui, base } = await uiServer('omc-check-comments-', factory)
    try {
      const cookie = await signIn(base)
      const res = await fetch(`${base}/api/records/check-comments`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ platform: 'douyin', item: 'i1' }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ added: 0, total: 0, pages: 1, stopped: 'empty' })
    } finally { await ui.close() }
  })

  it('群发只发勾选的候选，手动加号先认人', async () => {
    const factory = ((platform: string) => ({
      creator: async (target: string) => {
        if (target === 'qi.emama') return { id: 'MS4wLjABAAAA_resolved', name: '测试号', url: null }
        throw new Error(`无法识别的用户：${target}`)
      },
    })) as any
    const { out, ui, base } = await uiServer('omc-pick-', factory)
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      // 手动加号：能识别的换成 sec_uid 存，认不出的 400 且不入池
      const ok = await fetch(`${base}/api/candidates`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'dm', platform: 'douyin', itemId: 'manual', userId: 'qi.emama' }) })
      expect(ok.status).toBe(201)
      const bad = await fetch(`${base}/api/candidates`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'dm', platform: 'douyin', itemId: 'manual', userId: 'nobody' }) })
      expect(bad.status).toBe(400)
      const pool = await (await fetch(`${base}/api/candidates`, { headers: { cookie } })).json() as { candidates: Array<{ id: string; userId: string }> }
      expect(pool.candidates).toHaveLength(1)
      expect(pool.candidates[0]!.userId).toBe('MS4wLjABAAAA_resolved')
      // 再放一个候选，但群发只勾第一个
      const poolFile = join(out, 'users', 'admin', 'candidates.json')
      const saved = JSON.parse(await readFile(poolFile, 'utf8')) as { items: any[] }
      saved.items.push({ ...saved.items[0], id: 'second', userId: 'MS4wLjABAAAA_second' })
      await writeFile(poolFile, JSON.stringify(saved))
      const started = await fetch(`${base}/api/campaigns`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'dm', text: '你好', ids: [pool.candidates[0]!.id], minSeconds: 5, maxSeconds: 5 }) })
      expect(started.status).toBe(202)
      const job = await started.json() as { total: number }
      expect(job.total).toBe(1)
      const empty = await fetch(`${base}/api/campaigns`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'dm', text: '你好', ids: [], minSeconds: 5, maxSeconds: 5 }) })
      expect(empty.status).toBe(400)
    } finally { await ui.close() }
  })

  it('deletes a platform account and clears the current pointer', async () => {
    const { out, ui, base } = await uiServer('omc-acct-del-')
    try {
      const cookie = await signIn(base)
      const dir = join(out, 'users', 'admin', '.catbus', 'auth', 'douyin', 'web')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'default.json'), JSON.stringify({ method: 'cookie', user: { name: '墙左墙右' } }) + '\n')
      await writeFile(join(dir, '_current'), 'default\n')
      const before = await (await fetch(`${base}/api/accounts?platform=douyin`, { headers: { cookie } })).json() as { accounts: Array<{ account: string; current: boolean }> }
      expect(before.accounts).toHaveLength(1)
      expect(before.accounts[0]).toMatchObject({ account: 'default', current: true })
      const removed = await (await fetch(`${base}/api/accounts/delete`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ platform: 'douyin', account: 'default' }),
      })).json() as { ok: boolean }
      expect(removed.ok).toBe(true)
      const after = await (await fetch(`${base}/api/accounts?platform=douyin`, { headers: { cookie } })).json() as { accounts: unknown[] }
      expect(after.accounts).toEqual([])
      await expect(readFile(join(dir, '_current'), 'utf8')).rejects.toThrow()
    } finally { await ui.close() }
  })

  it('删除用户默认保留数据，purgeData 需要二次确认且拒绝路径越界', async () => {
    const { out, ui, base } = await uiServer('omc-user-purge-')
    try {
      const admin = await signIn(base)
      const adminAuth = { cookie: admin }
      await addUser(base, admin, 'bob')
      await addUser(base, admin, 'carol')
      const bobDir = join(out, 'users', 'bob')
      const carolDir = join(out, 'users', 'carol')
      await mkdir(bobDir, { recursive: true })
      await mkdir(carolDir, { recursive: true })
      await writeFile(join(bobDir, 'keep.jsonl'), '{}\n', 'utf8')
      await writeFile(join(carolDir, 'gone.jsonl'), '{}\n', 'utf8')

      // 默认只删账号，数据目录保留。
      expect((await fetch(`${base}/api/users/bob`, { method: 'DELETE', headers: adminAuth })).status).toBe(200)
      expect((await readdir(bobDir)).length).toBeGreaterThan(0)

      // 开了 purgeData 但没有 confirm，拒绝且数据仍在。
      const noConfirm = await fetch(`${base}/api/users/carol?purgeData=1`, { method: 'DELETE', headers: adminAuth })
      expect(noConfirm.status).toBe(400)
      expect((await readdir(carolDir)).length).toBeGreaterThan(0)

      // confirm 写错用户名也不行。
      const wrongConfirm = await fetch(`${base}/api/users/carol?purgeData=1&confirm=bob`, { method: 'DELETE', headers: adminAuth })
      expect(wrongConfirm.status).toBe(400)
      expect((await readdir(carolDir)).length).toBeGreaterThan(0)

      const purged = await fetch(`${base}/api/users/carol?purgeData=1&confirm=carol`, { method: 'DELETE', headers: adminAuth })
      expect(purged.status).toBe(200)
      expect((await purged.json() as { purgedData: boolean }).purgedData).toBe(true)
      await expect(readdir(carolDir)).rejects.toThrow()

      // 路径越界（编码的 ../）在接口层也必须被拒。
      const victim = join(out, 'victim')
      await mkdir(victim, { recursive: true })
      await writeFile(join(victim, 'secret.txt'), 'keep\n', 'utf8')
      const traversal = await fetch(`${base}/api/users/${encodeURIComponent('../victim')}?purgeData=1&confirm=${encodeURIComponent('../victim')}`, {
        method: 'DELETE', headers: adminAuth,
      })
      expect(traversal.status).toBe(400)
      expect(await readFile(join(victim, 'secret.txt'), 'utf8')).toBe('keep\n')
    } finally { await ui.close() }
  })

  it('registers a real-name account, blocks it until approved, and lets admin reset the password', async () => {
    const { ui, base } = await uiServer('omc-ui-reg-')
    const login = (username: string, password: string) => fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    try {
      const admin = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie: admin }

      expect((await fetch(`${base}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'a', password: 'passw0rd!' }) })).status).toBe(400)
      const reg = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '张三', password: 'passw0rd!' }) })
      expect(reg.status).toBe(201)
      expect((await reg.json() as { status: string }).status).toBe('pending')

      expect((await login('张三', 'passw0rd!')).status).toBe(403)

      const list = await (await fetch(`${base}/api/users`, { headers: { cookie: admin } })).json() as { users: Array<{ username: string; status: string }> }
      expect(list.users.find((u) => u.username === '张三')?.status).toBe('pending')

      expect((await fetch(`${base}/api/users/${encodeURIComponent('张三')}/status`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'active' }) })).status).toBe(200)
      expect((await login('张三', 'passw0rd!')).status).toBe(200)

      expect((await fetch(`${base}/api/users/${encodeURIComponent('张三')}/password`, { method: 'POST', headers: auth, body: JSON.stringify({ password: 'newpassw0rd!' }) })).status).toBe(200)
      expect((await login('张三', 'passw0rd!')).status).toBe(401)
      expect((await login('张三', 'newpassw0rd!')).status).toBe(200)

      expect((await fetch(`${base}/api/users/${encodeURIComponent('张三')}/status`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'disabled' }) })).status).toBe(200)
      expect((await login('张三', 'newpassw0rd!')).status).toBe(403)
    } finally { await ui.close() }
  })

  it('凭证缺私钥时，私信发送前就被挡住并说明原因', async () => {
    const { out, ui, base } = await uiServer('omc-keyless-')
    try {
      const cookie = await signIn(base)
      // 造一份没有 private_key 的凭证：这正是「王晓桐」那个号的真实状态
      const authFile = join(out, 'users', 'admin', '.catbus', 'auth', 'douyin', 'web', 'default.json')
      await mkdir(dirname(authFile), { recursive: true })
      await writeFile(authFile, JSON.stringify({ platform: 'douyin', endpoint: 'web', account: 'default', user: { id: 'x' }, scopes: { main: { tokens: {} } }, device: {} }) + '\n')
      const res = await fetch(`${base}/api/chat/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ platform: 'douyin', peerId: 'MS4wLjABAAAAS-JyHtruxnSkbGn4X0jEPm0Smk8_uuuJS3D4UL9RaTA', text: '你好' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code?: string; error?: string }
      expect(body.code).toBe('NO_PRIVATE_KEY')
      expect(body.error).toContain('私钥')
    } finally {
      await ui.close()
    }
  })

  it('stores a per-user lexicon, lists chat threads, and exposes usage to admins only', async () => {
    const { ui, base } = await uiServer('omc-ui-lex-')
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      expect(await (await fetch(`${base}/api/lexicon`, { headers: { cookie } })).json()).toEqual({ keywords: [], filters: [] })
      const saved = await (await fetch(`${base}/api/lexicon`, { method: 'POST', headers: auth, body: JSON.stringify({ keywords: '消防 贷款，消防', filters: ['价格'] }) })).json()
      expect(saved).toEqual({ keywords: ['消防', '贷款'], filters: ['价格'] })
      expect(await (await fetch(`${base}/api/lexicon`, { headers: { cookie } })).json()).toEqual(saved)

      const usage = await fetch(`${base}/api/admin/usage`, { headers: { cookie } })
      expect(usage.status).toBe(200)
      const body = await usage.json() as { users: Array<{ username: string; bytes: number; leads: number }> }
      expect(body.users[0]).toMatchObject({ username: 'admin' })
      expect(typeof body.users[0]!.bytes).toBe('number')

      await fetch(`${base}/api/users`, { method: 'POST', headers: auth, body: JSON.stringify({ username: 'bob', password: 'password123', role: 'user' }) })
      const bobLogin = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'bob', password: 'password123' }) })
      const bobCookie = bobLogin.headers.get('set-cookie')!.split(';')[0]!
      expect((await fetch(`${base}/api/admin/usage`, { headers: { cookie: bobCookie } })).status).toBe(403)

      const activity = await fetch(`${base}/api/admin/activity?days=7`, { headers: { cookie } })
      expect(activity.status).toBe(200)
      const actBody = await activity.json() as { days: number; users: Array<{ username: string; totals: { comments: number }; days: unknown[] }> }
      expect(actBody.days).toBe(7)
      expect(actBody.users.map((u) => u.username)).toContain('admin')
      expect(typeof actBody.users[0]!.totals.comments).toBe('number')
      expect((await fetch(`${base}/api/admin/activity`, { headers: { cookie: bobCookie } })).status).toBe(403)

      const day = await fetch(`${base}/api/admin/day?user=admin&date=2026-11-13`, { headers: { cookie } })
      expect(day.status).toBe(200)
      const dayBody = await day.json() as { user: string; leads: unknown[]; jobs: unknown[]; totals: { leads: number } }
      expect(dayBody.user).toBe('admin')
      expect(Array.isArray(dayBody.leads)).toBe(true)
      expect(Array.isArray(dayBody.jobs)).toBe(true)
      expect((await fetch(`${base}/api/admin/day?user=admin&date=bad`, { headers: { cookie } })).status).toBe(400)
      expect((await fetch(`${base}/api/admin/day?user=admin&date=2026-11-13`, { headers: { cookie: bobCookie } })).status).toBe(403)

      expect(await (await fetch(`${base}/api/chat/threads`, { headers: { cookie } })).json()).toEqual({ threads: [] })
      expect((await fetch(`${base}/api/chat/messages`, { headers: { cookie } })).status).toBe(400)
      expect((await fetch(`${base}/api/chat/send`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'douyin', peerId: '', text: 'x' }) })).status).toBe(400)
      expect((await fetch(`${base}/api/chat/send`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'douyin', peerId: 'u1', text: '' }) })).status).toBe(400)
      expect((await fetch(`${base}/api/chat/sync`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'nope', peerId: 'u1' }) })).status).toBe(400)
    } finally { await ui.close() }
  })

  it('send config is global, defaults to 25/day and 50 per batch, admin-only write', async () => {
    const { ui, base } = await uiServer('omc-ui-send-')
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      const first = await (await fetch(`${base}/api/settings`, { headers: { cookie } })).json() as Record<string, number>
      expect(first).toMatchObject({ dailyCap: 25, batchMax: 50, minSeconds: 30, maxSeconds: 90 })

      const saved = await (await fetch(`${base}/api/settings`, { method: 'POST', headers: auth, body: JSON.stringify({ dailyCap: 40, batchMax: 80, minSeconds: 40, maxSeconds: 120 }) })).json() as Record<string, number>
      expect(saved).toMatchObject({ dailyCap: 40, batchMax: 80, minSeconds: 40, maxSeconds: 120 })

      // 普通账号也能读到全局值（只读），写入被拒
      await fetch(`${base}/api/users`, { method: 'POST', headers: auth, body: JSON.stringify({ username: '王五', password: 'pass12345', role: 'user' }) })
      const users = await (await fetch(`${base}/api/users`, { headers: { cookie } })).json() as { users: Array<{ username: string; status: string }> }
      const wang = users.users.find((one) => one.username === '王五')!
      await fetch(`${base}/api/users/${encodeURIComponent(wang.username)}/status`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'active' }) })
      const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '王五', password: 'pass12345' }) })
      const userCookie = String(login.headers.get('set-cookie') ?? '').split(';')[0]!
      const mine = await (await fetch(`${base}/api/settings`, { headers: { cookie: userCookie } })).json() as Record<string, number>
      expect(mine.dailyCap).toBe(40)
      const denied = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: userCookie }, body: JSON.stringify({ dailyCap: 999 }) })
      expect(denied.status).toBe(403)
    } finally { await ui.close() }
  })

  it('admin cleanup previews and removes old comments that no filter matched', async () => {
    const { out, ui, base } = await uiServer('omc-ui-clean-')
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      const dir = join(out, 'users', 'admin', 'douyin')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'search_comment_2025-01-01.jsonl'), [
        JSON.stringify({ id: 'old-hit', item_id: 'i1', text: '消防设计多少钱', created_at: '2025-01-01T10:00:00+08:00' }),
        JSON.stringify({ id: 'old-miss', item_id: 'i1', text: '路过看看', created_at: '2025-01-01T10:00:00+08:00' }),
        JSON.stringify({ id: 'new-miss', item_id: 'i1', text: '路过看看', created_at: new Date().toISOString() }),
      ].join('\n') + '\n', 'utf8')
      await fetch(`${base}/api/lexicon`, { method: 'POST', headers: auth, body: JSON.stringify({ keywords: [], filters: ['消防'] }) })

      const preview = await (await fetch(`${base}/api/admin/cleanup?days=30`, { headers: { cookie } })).json() as { totals: { candidates: number; total: number } }
      expect(preview.totals).toMatchObject({ candidates: 1, total: 3 })

      expect((await fetch(`${base}/api/admin/cleanup`, { method: 'POST', headers: auth, body: JSON.stringify({ days: 30, confirm: 'no' }) })).status).toBe(400)
      const run = await (await fetch(`${base}/api/admin/cleanup`, { method: 'POST', headers: auth, body: JSON.stringify({ days: 30, confirm: '确认清理' }) })).json() as { removed: number }
      expect(run.removed).toBe(1)

      const after = await (await fetch(`${base}/api/admin/cleanup?days=30`, { headers: { cookie } })).json() as { totals: { candidates: number; total: number } }
      expect(after.totals).toMatchObject({ candidates: 0, total: 2 })
      expect((await fetch(`${base}/api/admin/cleanup`, { headers: { cookie: `omc_session=none` } })).status).toBe(401)
    } finally { await ui.close() }
  })

  it('serves the comment tree of a freshly crawled item through /api/records/comments', async () => {
    const cmt = (id: string, itemId: string, replies: number | null = null, parentId: string | null = null): Comment =>
      ({ id, item_id: itemId, parent_id: parentId, author: null, text: `评论 ${id}`, created_at: null, stats: { likes: null, replies } })
    const client: CrawlPlatformClient = {
      async search() { return { items: [item('i1'), item('i2')], hasMore: false, cursor: null } },
      async detail(id) { return item(id.replace('https://example.test/', '')) },
      async comments(ref) {
        return ref.endsWith('i1')
          ? [cmt('a1', 'i1', 2), cmt('a2', 'i1', 0), cmt('a3', 'i1', 0), cmt('a4', 'i1', 0)]
          : [cmt('b1', 'i2', 0), cmt('b2', 'i2', 0), cmt('b3', 'i2', 0)]
      },
      async subComments(_ref, cid) { return [cmt(`${cid}-r1`, 'i1', null, cid), cmt(`${cid}-r2`, 'i1', null, cid)] },
      async creator(id) { return user(id) },
      async creatorItems() { return [] },
      async download() { return 0 },
    }
    const { out, ui, base } = await uiServer('omc-ui-comments-', () => client)
    try {
      const cookie = await signIn(base)
      const auth = { 'content-type': 'application/json', cookie }
      // 先打开一次「已采数据」，让 loadIndex 的缓存先填上，再看采集结束后会不会刷新
      expect((await (await fetch(`${base}/api/records?platform=xhs`, { headers: { cookie } })).json() as { items: unknown[] }).items).toEqual([])
      const started = await fetch(`${base}/api/jobs`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 5, comments: true, subComments: true, maxComments: 50, sleep: '0' }) })
      const { id } = await started.json() as { id: string }
      await (await fetch(`${base}/api/jobs/${id}/events`, { headers: { cookie } })).text()

      const records = await (await fetch(`${base}/api/records?platform=xhs`, { headers: { cookie } })).json() as { items: Array<{ id: string; comments: number }> }
      expect(records.items.map((one) => [one.id, one.comments]).sort()).toEqual([['i1', 6], ['i2', 3]])
      const one = await (await fetch(`${base}/api/records/comments?platform=xhs&item=i1`, { headers: { cookie } })).json() as { comments: Array<{ id: string; children: Array<{ id: string }> }> }
      expect(one.comments.map((c) => c.id)).toEqual(['a1', 'a2', 'a3', 'a4'])
      expect(one.comments[0]!.children.map((c) => c.id)).toEqual(['a1-r1', 'a1-r2'])
      const other = await (await fetch(`${base}/api/records/comments?platform=xhs&item=i2`, { headers: { cookie } })).json() as { comments: unknown[] }
      expect(other.comments).toHaveLength(3)

      const jobs = await readFile(join(out, 'users', 'admin', 'jobs.jsonl'), 'utf8')
      const recorded = JSON.parse(jobs.trim().split('\n').pop()!) as { comments: number; newComments: number; status: string }
      expect(recorded).toMatchObject({ comments: 9, newComments: 9, status: 'done' })
    } finally { await ui.close() }
  })

  it('tells the console that a platform has no comment list instead of failing the job', async () => {
    const client: CrawlPlatformClient = {
      async search() { return { items: [item('i1')], hasMore: false, cursor: null } },
      async detail(id) { return item(id.replace('https://example.test/', '')) },
      async comments() { throw new CatbusError('UNSUPPORTED', 'weibo 不支持 comment list') },
      async subComments() { return [] },
      async creator(id) { return user(id) },
      async creatorItems() { return [] },
      async download() { return 0 },
    }
    const { out, ui, base } = await uiServer('omc-ui-nocomments-', () => client)
    try {
      const cookie = await signIn(base)
      const started = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ platform: 'weibo', type: 'search', keywords: 'k', maxItems: 5, comments: true, sleep: '0' }) })
      const { id } = await started.json() as { id: string }
      await (await fetch(`${base}/api/jobs/${id}/events`, { headers: { cookie } })).text()
      const log = await (await fetch(`${base}/api/jobs/${id}/log`, { headers: { cookie } })).json() as { status: string; commentsUnsupported: boolean; lines: Array<{ message: string }> }
      expect(log.status).toBe('done')
      expect(log.commentsUnsupported).toBe(true)
      expect(log.lines.some((line) => line.message.includes('暂不支持评论采集'))).toBe(true)
      const job = (await (await fetch(`${base}/api/jobs`, { headers: { cookie } })).json() as Array<{ id: string; result: { commentsUnsupported?: boolean } }>).find((one) => one.id === id)!
      expect(job.result.commentsUnsupported).toBe(true)
      expect((await readdir(join(out, 'users', 'admin', 'weibo'))).some((name) => name.includes('item'))).toBe(true)
    } finally { await ui.close() }
  })

  it('stops a running crawl job', async () => {
    const out = await tempDir('omc-ui-stop-')
    const home = await tempDir('omc-stop-home-')
    process.env.OMC_USERS_FILE = join(home, 'users.json')
    process.env.OMC_ADMIN_PASSWORD = 'adminpass123'
    const calls: string[] = []
    const slow: CrawlPlatformClient = {
      async search(_k, cursor) { calls.push(String(cursor)); await new Promise((done) => setTimeout(done, 200)); return { items: [item(`s${calls.length}`)], hasMore: true, cursor: `c${calls.length}` } },
      async detail(id) { return item(id) },
      async comments() { return [] },
      async subComments() { return [] },
      async creator(id) { return user(id) },
      async creatorItems() { return [] },
      async download() { return 0 },
    }
    const ui = await startUiServer({ port: 0, out, clientFactory: () => slow })
    const base = `http://${ui.host}:${ui.port}`
    try {
      const cookie = await signIn(base)
      const started = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 50, sleep: '0' }) })
      const { id } = await started.json() as { id: string }
      await new Promise((done) => setTimeout(done, 250))
      expect((await fetch(`${base}/api/jobs/${id}/stop`, { method: 'POST', headers: { cookie } })).status).toBe(200)
      let job = { status: 'running' }
      for (let i = 0; i < 40 && job.status === 'running'; i++) {
        await new Promise((done) => setTimeout(done, 100))
        const list = await (await fetch(`${base}/api/jobs`, { headers: { cookie } })).json() as Array<{ id: string; status: string }>
        job = list.find((j) => j.id === id)!
      }
      expect(job.status).toBe('stopped')
      const log = await (await fetch(`${base}/api/jobs/${id}/log`, { headers: { cookie } })).json() as { status: string; lines: Array<{ message: string }> }
      expect(log.status).toBe('stopped')
      expect(Array.isArray(log.lines)).toBe(true)
      expect(log.lines.length).toBeGreaterThan(0)
    } finally { await ui.close() }
  })

  it('线索同步按指纹跳过没变化的重算，采集结果变了或被清空后能重新同步', async () => {
    const { out, ui, base } = await uiServer('omc-ui-sync-')
    try {
      const cookie = await signIn(base)
      const auth = { cookie }
      const dir = join(out, 'users', 'admin', 'douyin')
      await mkdir(dir, { recursive: true })
      const line = (id: string, text: string): string => JSON.stringify({ id, item_id: 'i1', parent_id: null, author: { id: `u${id}`, name: id }, text, created_at: '2026-11-12T10:00:00+08:00', stats: { likes: 0, replies: 0 } })
      await writeFile(join(dir, 'a.jsonl'), [line('c1', '多少钱'), line('c2', '路过看看')].join('\n') + '\n', 'utf8')

      const sync = async () => await (await fetch(`${base}/api/leads/sync`, { method: 'POST', headers: auth })).json() as { skipped?: boolean; built: number; added: number; total: number }
      expect(await sync()).toMatchObject({ built: 2, added: 2, total: 2 })
      // 内容没变：不重算，直接回原来的总数
      expect(await sync()).toMatchObject({ skipped: true, built: 0, added: 0, total: 2 })

      // 采集结果变了（多了条评论）：必须重算
      await writeFile(join(dir, 'a.jsonl'), [line('c1', '多少钱'), line('c2', '路过看看'), line('c3', '怎么卖')].join('\n') + '\n', 'utf8')
      const changed = await sync()
      expect(changed.skipped).toBeUndefined()
      expect(changed).toMatchObject({ built: 3, added: 1, total: 3 })

      // 线索文件被删（用户清空线索）：下次同步要能重新补回来，不能被指纹卡死
      await rm(join(out, 'users', 'admin', 'leads.jsonl'), { force: true })
      expect(await sync()).toMatchObject({ built: 3, added: 3, total: 3 })
    } finally { await ui.close() }
  })
})

describe('perf: 线索缓存 / 账本索引 / 候选批量 / index LRU', () => {
  const lead = (id: string, text: string): Lead => ({
    id, platform: 'douyin', comment_id: id.slice(id.indexOf(':') + 1), item_id: 'i1',
    item_title: '作品一', item_url: null, author_id: 'u1', author_name: '张三', text,
    created_at: '2026-11-12T10:00:00+08:00', province: null, matched: [], contacts: [],
    collected_at: '2026-11-12T12:00:00+08:00',
  })
  const lines = (leads: Lead[]): string => leads.map((one) => JSON.stringify(one)).join('\n') + '\n'

  it('LeadStore 以 mtime+size 为失效键：没改动不重复读盘，外部改动后读到新内容', async () => {
    const dir = await tempDir('omc-lead-cache-')
    const file = join(dir, 'leads.jsonl')
    await writeFile(file, lines([lead('douyin:c1', '一')]), 'utf8')
    let reads = 0
    const store = new LeadStore(file, { onRead: () => { reads++ } })

    expect((await store.load()).map((one) => one.text)).toEqual(['一'])
    expect(reads).toBe(1)
    // 另一个实例（ui.ts 每个请求都会 new 一个）也吃同一份缓存
    expect((await new LeadStore(file).load()).map((one) => one.text)).toEqual(['一'])
    expect(reads).toBe(1)

    // 外部改文件：指纹变了，必须重新解析
    await writeFile(file, lines([lead('douyin:c1', '二'), lead('douyin:c2', '三')]), 'utf8')
    expect((await store.load()).map((one) => one.text)).toEqual(['二', '三'])
    expect(reads).toBe(2)
  })

  it('LeadStore 写之后缓存跟着走：upsert / clear 之后立刻读到新内容且不重读', async () => {
    const dir = await tempDir('omc-lead-write-')
    const file = join(dir, 'leads.jsonl')
    let reads = 0
    const store = new LeadStore(file, { onRead: () => { reads++ } })

    expect(await store.upsert([lead('douyin:c1', '一'), lead('douyin:c2', '二')])).toEqual({ added: 2, total: 2 })
    expect(reads).toBe(1) // upsert 内部读那一次
    expect((await store.load()).map((one) => one.id)).toEqual(['douyin:c1', 'douyin:c2'])
    expect(reads).toBe(1) // 写完的内容直接进缓存，没有再读盘

    expect(await store.upsert([lead('douyin:c2', '二的改版'), lead('douyin:c3', '三')])).toEqual({ added: 1, total: 3 })
    expect((await store.load()).map((one) => one.text)).toEqual(['一', '二的改版', '三'])

    await store.clear()
    expect(await store.load()).toEqual([])
    expect(reads).toBe(1)
  })

  it('SendLedger 一次读入内存索引：连续 canSend 不重复读盘，record 后立即生效', async () => {
    const dir = await tempDir('omc-ledger-')
    const file = join(dir, 'sent.jsonl')
    const record = (target: string, at: string): string => JSON.stringify({ platform: 'douyin', target, kind: 'reply', at, ok: true })
    await writeFile(file, record('c1', '2026-11-12T10:00:00+08:00') + '\n', 'utf8')
    let reads = 0
    const ledger = new SendLedger(file, { onRead: () => { reads++ } })
    const now = new Date('2026-11-12T20:00:00+08:00')

    // 群发前校验 300 个人：只读一遍账本
    for (let i = 0; i < 300; i++) {
      expect((await ledger.canSend('douyin', `c${i + 100}`, 'reply', { now })).ok).toBe(true)
    }
    expect(reads).toBe(1)
    expect(await ledger.canSend('douyin', 'c1', 'reply', { now })).toEqual({ ok: false, reason: '已发送过' })

    // record 之后立刻能拦住同一个 target，日计数 +1，且没有整体重读
    await ledger.record({ platform: 'douyin', target: 'c2', kind: 'reply', ok: true, at: '2026-11-12T11:00:00+08:00' })
    expect(await ledger.canSend('douyin', 'c2', 'reply', { now })).toEqual({ ok: false, reason: '已发送过' })
    expect(await ledger.sentToday('douyin', now)).toBe(2)
    expect(reads).toBe(1)
    expect(await ledger.canSend('douyin', 'c999', 'reply', { dailyCap: 2, now })).toEqual({ ok: false, reason: '今天已到上限' })

    // 外部（另一个进程）追加了记录：指纹变了要整体重载
    await appendFile(file, record('c3', '2026-11-12T12:00:00+08:00') + '\n')
    expect(await ledger.canSend('douyin', 'c3', 'reply', { now })).toEqual({ ok: false, reason: '已发送过' })
    expect(reads).toBe(2)
  })

  it('候选批量入池：一次读一次写，重复的只留一份，单条包装保持原语义', async () => {
    const root = await tempDir('omc-cands-')
    const poolFile = join(root, 'candidates.json')
    const inputs = Array.from({ length: 300 }, (_, i) => ({ type: 'dm' as const, platform: 'douyin', itemId: 'i1', userId: `u${i}`, userName: `用户${i}` }))

    const result = await addCandidates(root, inputs)
    expect(result.added).toHaveLength(300)
    expect(result.existing).toHaveLength(0)
    expect(result.invalid).toBe(0)
    expect(await listCandidates(root)).toHaveLength(300)

    // 同一批里重复的只留一份；不合法的单条只计数，不影响其它条
    const same = await addCandidates(root, [
      { type: 'reply', platform: 'douyin', itemId: 'i1', commentId: 'k1' },
      { type: 'reply', platform: 'douyin', itemId: 'i1', commentId: 'k1' },
      { type: 'dm', platform: 'douyin', itemId: 'i1' }, // 没有 userId
    ])
    expect(same.added).toHaveLength(1)
    expect(same.existing).toHaveLength(1)
    expect(same.invalid).toBe(1)

    // 全部重复时不重写文件
    const before = (await stat(poolFile)).mtimeMs
    const again = await addCandidates(root, inputs)
    expect(again.added).toHaveLength(0)
    expect(again.existing).toHaveLength(300)
    expect((await stat(poolFile)).mtimeMs).toBe(before)

    // 单条包装：重复时回传已有那条，非法输入照旧抛 USAGE
    const single = await addCandidate(root, inputs[0]!)
    expect(single.added).toBe(false)
    expect(single.candidate.id).toBe(result.added[0]!.id)
    await expect(addCandidate(root, { type: 'reply', platform: 'douyin', itemId: 'i1' })).rejects.toThrow('commentId')
    expect(await listCandidates(root)).toHaveLength(301)
  })

  it('records 缓存按 MEDIACRAWL_RECORD_CACHE_MAX 做 LRU，超出淘汰最久未用', async () => {
    resetRecordCache()
    const saved = process.env.MEDIACRAWL_RECORD_CACHE_MAX
    try {
      const dirs = [await tempDir('omc-lru-a-'), await tempDir('omc-lru-b-')]
      for (const dir of dirs) {
        await mkdir(join(dir, 'xhs'), { recursive: true })
        await writeFile(join(dir, 'xhs', 'a.jsonl'), JSON.stringify(item('i1')) + '\n', 'utf8')
      }

      process.env.MEDIACRAWL_RECORD_CACHE_MAX = '1'
      const first = await loadIndex(dirs[0]!, 'xhs')
      expect(await loadIndex(dirs[0]!, 'xhs')).toBe(first) // 命中：同一个对象
      const other = await loadIndex(dirs[1]!, 'xhs')
      expect(other).not.toBe(first)
      const evicted = await loadIndex(dirs[0]!, 'xhs') // 上限 1：第一份已经被挤掉，重新解析
      expect(evicted).not.toBe(first)
      expect(evicted.items.map((one) => one.id)).toEqual(['i1'])

      process.env.MEDIACRAWL_RECORD_CACHE_MAX = '2'
      resetRecordCache()
      const a = await loadIndex(dirs[0]!, 'xhs')
      await loadIndex(dirs[1]!, 'xhs')
      expect(await loadIndex(dirs[0]!, 'xhs')).toBe(a) // 命中后算「最近使用」，不会被自己挤掉
    } finally {
      if (saved === undefined) delete process.env.MEDIACRAWL_RECORD_CACHE_MAX
      else process.env.MEDIACRAWL_RECORD_CACHE_MAX = saved
      resetRecordCache()
    }
  })
})
