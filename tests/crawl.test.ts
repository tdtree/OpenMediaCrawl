import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

describe('web UI', () => {
  const savedEnv = { users: process.env.OMC_USERS_FILE, password: process.env.OMC_ADMIN_PASSWORD, bin: process.env.MEDIACRAWL_BIN }
  afterEach(() => {
    if (savedEnv.users === undefined) delete process.env.OMC_USERS_FILE; else process.env.OMC_USERS_FILE = savedEnv.users
    if (savedEnv.password === undefined) delete process.env.OMC_ADMIN_PASSWORD; else process.env.OMC_ADMIN_PASSWORD = savedEnv.password
    if (savedEnv.bin === undefined) delete process.env.MEDIACRAWL_BIN; else process.env.MEDIACRAWL_BIN = savedEnv.bin
  })

  async function uiServer(prefix: string) {
    const out = await tempDir(prefix)
    const home = await tempDir(`${prefix}home-`)
    process.env.OMC_USERS_FILE = join(home, 'users.json')
    process.env.OMC_ADMIN_PASSWORD = 'adminpass123'
    const ui = await startUiServer({ port: 0, out, clientFactory: () => baseClient([]) })
    return { out, ui, base: `http://${ui.host}:${ui.port}` }
  }

  async function signIn(base: string, username = 'admin', password = 'adminpass123'): Promise<string> {
    const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    expect(response.status).toBe(200)
    return response.headers.get('set-cookie')!.split(';')[0]!
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
      expect(status.message).toContain('3 分钟')
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

      const built = await (await fetch(`${base}/api/leads/build`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ platform: 'douyin', intent: '多少钱,怎么卖' }) })).json() as { built: number; added: number }
      expect(built).toMatchObject({ built: 1, added: 1 })

      const leads = await (await fetch(`${base}/api/leads?platform=douyin`, { headers: auth })).json() as { total: number; items: Array<{ id: string; contacts: Array<{ type: string; value: string }>; matched: string[] }> }
      expect(leads.total).toBe(1)
      expect(leads.items[0]!.matched).toEqual(['多少钱'])
      expect(leads.items[0]!.contacts[0]).toMatchObject({ type: 'wechat', value: 'abc_123' })

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
})
