import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Comment, Item, Media } from '../src/core/schemas.js'
import { runCrawl } from '../src/crawl/job.js'
import { loadIndex, resetRecordCache } from '../src/crawl/records.js'
import { openContentStore } from '../src/crawl/shared/store.js'
import { importLegacy } from '../src/crawl/shared/import.js'
import { decideReuse, type ReuseSnapshot } from '../src/crawl/shared/reuse.js'
import { DEFAULT_POLICY, type ReusePolicy } from '../src/crawl/shared/types.js'
import { startUiServer } from '../src/crawl/ui.js'
import type { CrawlOptions, CrawlPlatformClient } from '../src/crawl/types.js'

const item = (id: string, media: Media[] = []): Item => ({
  id, kind: 'video', url: `https://example.test/${id}`, title: id, text: `正文 ${id}`,
  author: { id: 'u1', name: '作者', url: null }, created_at: null, cover: null, media,
  stats: { views: 1, likes: 2, comments: 3, collects: 4, shares: 5 }, price: null, status: 'published',
})
const comment = (id: string, itemId = 'i1'): Comment => ({
  id, item_id: itemId, parent_id: null, author: { id: 'u2', name: '评论者', url: null }, text: `评论 ${id}`,
  created_at: '2026-11-12T10:00:00+08:00', stats: { likes: 0, replies: 0 },
})

const dirs: string[] = []
async function tempDir(prefix = 'omc-shared-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

const options = (out: string, over: Partial<CrawlOptions> = {}): CrawlOptions => ({
  platform: 'xhs', type: 'search', keywords: ['k'], ids: [], creators: [], maxItems: 1,
  comments: true, subComments: false, maxComments: 20, media: false, save: 'jsonl',
  out, sleep: '0', quiet: true, ...over,
})

function client(calls: string[], over: Partial<CrawlPlatformClient> = {}): CrawlPlatformClient {
  return {
    async search(keyword, cursor) { calls.push(`search:${keyword}:${cursor}`); return { items: [item('i1'), item('i2')], hasMore: false, cursor: null } },
    async detail(id) { calls.push(`detail:${id}`); return item(String(id).replace('https://example.test/', '')) },
    async comments(ref) { calls.push(`comments:${ref}`); return [comment('c1'), comment('c2')] },
    async subComments(_ref, cid) { calls.push(`sub:${cid}`); return [] },
    async creator(id) { calls.push(`creator:${id}`); return { id, name: id, handle: id, avatar: null, url: null, bio: null, stats: { followers: null, following: null, items: null, likes: null } } },
    async creatorItems(id) { calls.push(`creatorItems:${id}`); return [] },
    async download(it, dir) { calls.push(`download:${it.id}:${dir}`); return 1 },
    ...over,
  }
}

describe('共享内容库', () => {
  it('作品/评论/引用按 (platform,id) 唯一，重复写入只更新一份', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      store.putItem('xhs', item('i1'), { body: 'full', user: 'alice', account: 'acc1' })
      store.putItem('xhs', { ...item('i1'), title: '新标题' }, { body: 'full', user: 'bob' })
      store.putComments('xhs', 'i1', [comment('c1'), comment('c2')], { limit: 20, complete: false })
      store.putComments('xhs', 'i1', [comment('c2'), comment('c3')], { limit: 20, complete: false })

      expect(store.getItem('xhs', 'i1')?.data.title).toBe('新标题')
      expect(store.commentCount('xhs', 'i1')).toBe(3)
      expect(store.getCommentsState('xhs', 'i1')).toMatchObject({ limit: 20, complete: false })

      store.addRef('alice', 'xhs', 'i1', { jobId: 'j1', keyword: '露营' })
      store.addRef('bob', 'xhs', 'i1', { jobId: 'j2' })
      store.addRef('alice', 'xhs', 'i1', { jobId: 'j3' })
      expect(store.refUsers('xhs', 'i1').sort()).toEqual(['alice', 'bob'])
      expect(store.refCount('xhs', 'i1')).toBe(2)
      expect(store.listRefs('alice', 'xhs')).toHaveLength(1)
      expect(store.listRefs('alice', 'xhs')[0]).toMatchObject({ jobId: 'j3', keyword: '露营' })
      // 同一作品由第二个关键词采到：refs 仍一行，明细里两条都保留
      store.addRef('alice', 'xhs', 'i1', { jobId: 'j4', keyword: '消防' })
      expect(store.listRefKeywords('alice', 'xhs').map((row) => row.keyword).sort()).toEqual(['消防', '露营'])
      store.clearRefs('alice')
      expect(store.listRefKeywords('alice', 'xhs')).toHaveLength(0)
    } finally { store.close() }
  })

  it('复用判定：TTL、强制刷新、条数不够、媒体齐全', () => {
    const now = Date.UTC(2026, 10, 16)
    const day = 24 * 3600 * 1000
    const snapshot = (over: Partial<ReuseSnapshot> = {}): ReuseSnapshot => ({
      item: { body: 'full', fetchedAt: now - day },
      comments: { fetchedAt: now - 3600_000, limit: 20, complete: false, withReplies: false },
      media: { total: 2, ready: 2 },
      ...over,
    })
    const request = { wantComments: true, wantSubComments: false, wantMedia: true, maxComments: 20 }

    expect(decideReuse(snapshot(), request, DEFAULT_POLICY, now)).toMatchObject({ fetchItem: false, fetchComments: false, downloadMedia: false })
    // 作品超过 30 天窗口 → 只重抓正文
    const stale = decideReuse(snapshot({ item: { body: 'full', fetchedAt: now - 31 * day } }), request, DEFAULT_POLICY, now)
    expect(stale.fetchItem).toBe(true)
    // 评论超过 24 小时窗口
    const oldComments = decideReuse(snapshot({ comments: { fetchedAt: now - 25 * 3600_000, limit: 20, complete: false, withReplies: false } }), request, DEFAULT_POLICY, now)
    expect(oldComments.fetchComments).toBe(true)
    // 要 50 条但库里只有 20 条
    expect(decideReuse(snapshot(), { ...request, maxComments: 50 }, DEFAULT_POLICY, now).fetchComments).toBe(true)
    // 要楼中楼时，不完整的评论永远不算够
    expect(decideReuse(snapshot(), { ...request, wantSubComments: true }, DEFAULT_POLICY, now).fetchComments).toBe(true)
    // 强制刷新
    expect(decideReuse(snapshot(), request, { ...DEFAULT_POLICY, refresh: 'always' }, now)).toMatchObject({ fetchItem: true, fetchComments: true })
    // never：有就不抓
    expect(decideReuse(snapshot({ item: { body: 'full', fetchedAt: 0 } }), request, { ...DEFAULT_POLICY, refresh: 'never' }, now).fetchItem).toBe(false)
    // 媒体缺一个 → 下载
    expect(decideReuse(snapshot({ media: { total: 2, ready: 1 } }), request, DEFAULT_POLICY, now).downloadMedia).toBe(true)
  })

  it('旧断点文件 + 空共享库：不能整条跳过，要补引用再跳过', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      const out = await tempDir()
      // 旧版按用户落盘留下的断点：这些 id 都「采过」了，但共享库还没有任何内容。
      await writeFile(join(out, '.crawl-state-xhs-search.json'), JSON.stringify({
        items: ['i1'], comments: [], creators: [], tasks: {}, finished: true,
      }), 'utf8')
      const calls: string[] = []
      const first = await runCrawl(options(out), { client: client(calls), content: store, user: 'alice', jobId: 'j1' })
      expect(first.counts).toMatchObject({ items: 1, skipped: 0 })
      expect(store.hasRef('alice', 'xhs', 'i1')).toBe(true)
      expect(store.getItem('xhs', 'i1')?.body).toBe('full')

      // 第二次：引用已经有了，断点正常生效，不再请求详情/评论。
      calls.length = 0
      const second = await runCrawl(options(out), { client: client(calls), content: store, user: 'alice', jobId: 'j2' })
      expect(calls).toEqual(['search:k:null'])
      expect(second.counts).toMatchObject({ items: 0, skipped: 1 })
    } finally { store.close() }
  })

  it('中断的旧断点（关键词记着已完成）+ 空共享库：关键词要重跑而不是整段跳过', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      const out = await tempDir()
      await writeFile(join(out, '.crawl-state-xhs-search.json'), JSON.stringify({
        items: [], comments: [], creators: [], tasks: { 'search:k': { cursor: null, done: true } }, finished: false,
      }), 'utf8')
      const calls: string[] = []
      const result = await runCrawl(options(out), { client: client(calls), content: store, user: 'alice', jobId: 'j1' })
      expect(calls[0]).toBe('search:k:null')
      expect(result.counts.items).toBe(1)
      expect(store.hasRef('alice', 'xhs', 'i1')).toBe(true)
    } finally { store.close() }
  })

  it('两个用户采同一个关键词：第二个用户零详情、零评论请求，存储只有一份', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      const outA = await tempDir()
      const outB = await tempDir()
      const callsA: string[] = []
      const first = await runCrawl(options(outA), { client: client(callsA), content: store, user: 'alice', jobId: 'j1' })
      expect(callsA).toEqual(['search:k:null', 'detail:https://example.test/i1', 'comments:https://example.test/i1'])
      expect(first.counts).toMatchObject({ items: 1, comments: 2 })
      expect(store.commentCount('xhs', 'i1')).toBe(2)

      const callsB: string[] = []
      const second = await runCrawl(options(outB), { client: client(callsB), content: store, user: 'bob', jobId: 'j2' })
      expect(callsB).toEqual(['search:k:null'])
      expect(second.counts).toMatchObject({ items: 1, reusedItems: 1, comments: 0, reusedComments: 2 })
      expect(store.commentCount('xhs', 'i1')).toBe(2)
      expect(store.refUsers('xhs', 'i1')).toEqual(['alice', 'bob'])
      expect(store.getItem('xhs', 'i1')?.sourceUser).toBe('alice')

      // 用户侧只落轻量引用，正文不在用户目录里重复一份
      const file = join(outB, 'xhs', `search_item_${new Date().toISOString().slice(0, 10)}.jsonl`)
      const thin = JSON.parse((await readFile(file, 'utf8')).trim()) as Record<string, unknown>
      expect(thin).toMatchObject({ id: 'i1', shared: true })
      expect(thin.text).toBeUndefined()
    } finally { store.close() }
  })

  it('作品过了复用窗口会刷新，但只刷新一次、所有用户共用结果', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      const outA = await tempDir()
      await runCrawl(options(outA, { comments: false }), { client: client([]), content: store, user: 'alice', jobId: 'j1' })
      const stale: ReusePolicy = { ...DEFAULT_POLICY, itemTtlMs: -1 }
      const calls: string[] = []
      await runCrawl(options(await tempDir(), { comments: false }), { client: client(calls), content: store, user: 'bob', jobId: 'j2', policy: stale })
      expect(calls).toEqual(['search:k:null', 'detail:https://example.test/i1'])
      expect(store.refUsers('xhs', 'i1')).toEqual(['alice', 'bob'])
    } finally { store.close() }
  })

  it('增量评论：第二次过期重抓只追加新评论，老评论保留并记住首次出现时间', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      let latest: Comment[] = [comment('c1'), comment('c2')]
      const calls: string[] = []
      const live = client(calls, { async comments(ref) { calls.push(`comments:${ref}`); return latest } })
      const first = await runCrawl(options(await tempDir()), { client: live, content: store, user: 'alice', jobId: 'j1' })
      expect(first.counts).toMatchObject({ comments: 2, newComments: 2 })
      const c1Seen = store.listComments('xhs', 'i1').find((one) => one.id === 'c1')!.first_seen_at!

      // 过了评论窗口：平台最新列表里多了一条 c3，c1 掉出当前页
      latest = [comment('c3'), comment('c2')]
      await new Promise((done) => setTimeout(done, 5))
      calls.length = 0
      const outB = await tempDir()
      const second = await runCrawl(options(outB), {
        client: live, content: store, user: 'bob', jobId: 'j2',
        policy: { ...DEFAULT_POLICY, commentTtlMs: -1 },
      })
      expect(calls).toEqual(['search:k:null', 'comments:https://example.test/i1'])
      expect(second.counts).toMatchObject({ comments: 2, newComments: 1 })
      // 老评论不删，新评论追加
      expect(store.commentCount('xhs', 'i1')).toBe(3)
      const after = store.listComments('xhs', 'i1')
      expect(after.map((one) => one.id).sort()).toEqual(['c1', 'c2', 'c3'])
      expect(after.find((one) => one.id === 'c1')!.first_seen_at).toBe(c1Seen)
      expect(after.find((one) => one.id === 'c3')!.first_seen_at!).toBeGreaterThan(c1Seen)

      // 用户视图里这条作品带「最近 7 天新增 3 条」的标记
      resetRecordCache()
      const index = await loadIndex({ root: outB, store, user: 'bob' }, 'xhs')
      expect(index.items[0]).toMatchObject({ id: 'i1', comments: 3, new_comments: 3 })
    } finally { store.close() }
  })

  it('两个任务同时命中同一条作品时只发一次详情请求', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      const calls: string[] = []
      const slow = client(calls, {
        async detail(id) {
          calls.push(`detail:${id}`)
          await new Promise((done) => setTimeout(done, 300))
          return item('i1')
        },
      })
      const [a, b] = await Promise.all([
        runCrawl(options(await tempDir(), { comments: false }), { client: slow, content: store, user: 'alice', jobId: 'j1' }),
        runCrawl(options(await tempDir(), { comments: false }), { client: slow, content: store, user: 'bob', jobId: 'j2' }),
      ])
      expect(calls.filter((call) => call.startsWith('detail'))).toHaveLength(1)
      expect(a.counts.items + b.counts.items).toBe(2)
      expect(store.refCount('xhs', 'i1')).toBe(2)
    } finally { store.close() }
  })

  it('媒体按 sha256 只存一份：两个作品同一段字节也只占一个 blob', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      const media: Media = { id: null, type: 'video', url: 'https://example.test/v.mp4', width: null, height: null, duration: null }
      const writeVideo = async (dir: string, id: string): Promise<number> => {
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, `xhs_${id}_1.mp4`), Buffer.from('same-bytes'))
        return 1
      }
      await runCrawl(options(await tempDir(), { comments: false, media: true, maxItems: 1 }), {
        client: client([], {
          async search() { return { items: [item('a', [media])], hasMore: false, cursor: null } },
          async detail(id) { return item(String(id).replace('https://example.test/', ''), [media]) },
          async download(it, dir) { return writeVideo(dir, String(it.id)) },
        }),
        content: store, user: 'alice', jobId: 'j1',
      })
      await runCrawl(options(await tempDir(), { comments: false, media: true, maxItems: 1 }), {
        client: client([], {
          async search() { return { items: [item('b', [media])], hasMore: false, cursor: null } },
          async detail(id) { return item(String(id).replace('https://example.test/', ''), [media]) },
          async download(it, dir) { return writeVideo(dir, String(it.id)) },
        }),
        content: store, user: 'bob', jobId: 'j2',
      })
      const rowsA = store.mediaRows('xhs', 'a')
      const rowsB = store.mediaRows('xhs', 'b')
      expect(rowsA[0]?.sha256).toBeTruthy()
      expect(rowsB[0]?.sha256).toBe(rowsA[0]?.sha256)
      expect(store.usage().blobs).toBe(1)
      // 同一个作品的媒体第二次不再下载
      expect(store.blobExists(rowsA[0]!.sha256!)).toBe(true)
    } finally { store.close() }
  })

  it('GC 只删没有引用的内容，被引用的一条都不动', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      store.putItem('xhs', item('kept'), { body: 'full' })
      store.addRef('alice', 'xhs', 'kept')
      store.putItem('xhs', item('orphan'), { body: 'full' })
      store.putComments('xhs', 'orphan', [comment('c1', 'orphan')], { limit: 0, complete: true })
      // 把两条都改成 40 天前见过
      const db = new DatabaseSync(store.dbPath)
      db.prepare('UPDATE items SET seen_at = ?').run(Date.now() - 40 * 24 * 3600 * 1000)
      db.close()

      const plan = store.gc({ days: 30 })
      expect(plan.items.map((row) => row.id)).toEqual(['orphan'])
      expect(plan.comments).toBe(1)
      const applied = store.gc({ days: 30, apply: true })
      expect(applied.applied).toBe(true)
      expect(store.getItem('xhs', 'orphan')).toBeNull()
      expect(store.getItem('xhs', 'kept')?.id).toBe('kept')
      expect(store.commentCount('xhs', 'orphan')).toBe(0)
    } finally { store.close() }
  })

  it('请求日志能算出省了多少次请求', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      await runCrawl(options(await tempDir()), { client: client([]), content: store, user: 'alice', jobId: 'j1' })
      await runCrawl(options(await tempDir()), { client: client([]), content: store, user: 'bob', jobId: 'j2' })
      const stats = store.reuseStats()
      expect(stats.byKind.item).toMatchObject({ fetched: 1, reused: 1 })
      expect(stats.byKind.comments).toMatchObject({ fetched: 1, reused: 1 })
    } finally { store.close() }
  })

  it('清理按用户隐藏评论，不影响共享内容', async () => {
    const shared = await tempDir()
    const store = openContentStore(join(shared, 'shared'))
    try {
      store.putItem('xhs', item('i1'), { body: 'full' })
      store.putComments('xhs', 'i1', [comment('c1'), comment('c2')], { limit: 0, complete: true })
      store.hideComments('bob', 'xhs', 'i1', ['c1'])
      expect([...store.hiddenComments('bob', 'xhs', 'i1')]).toEqual(['c1'])
      expect(store.hiddenComments('alice', 'xhs', 'i1').size).toBe(0)
      expect(store.commentCount('xhs', 'i1')).toBe(2)
      expect(store.clearMasks('bob')).toBe(1)
    } finally { store.close() }
  })

  it('旧的按用户落盘数据可以幂等导入共享库', async () => {
    const root = await tempDir()
    const store = openContentStore(join(root, 'shared'))
    try {
      const dir = join(root, 'users', '管理员', 'douyin')
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'search_item_2026-11-12.jsonl')
      await writeFile(file, [
        JSON.stringify({ id: 'i1', kind: 'video', title: '作品一', url: 'https://x/i1', text: '正文', author: null, created_at: null, cover: null, media: [], stats: {}, price: null, status: 'published' }),
        JSON.stringify({ ...comment('c1', 'i1'), item_id: 'i1' }),
        JSON.stringify({ ...comment('c2', 'i1'), item_id: 'i1' }),
        JSON.stringify({ id: 'u1', name: '作者', handle: 'u1', avatar: null, url: null, bio: null, stats: { followers: 1, following: 0, items: 1, likes: 0 } }),
      ].join('\n') + '\n', 'utf8')

      const preview = await importLegacy(root, store)
      expect(preview).toMatchObject({ users: 1, files: 1, items: 1, comments: 2, creators: 1, applied: false })
      expect(store.getItem('douyin', 'i1')).toBeNull()

      const first = await importLegacy(root, store, { apply: true })
      expect(first).toMatchObject({ items: 1, comments: 2, creators: 1, refs: 1, applied: true })
      expect(store.getItem('douyin', 'i1')?.body).toBe('full')
      expect(store.commentCount('douyin', 'i1')).toBe(2)
      expect(store.hasRef('管理员', 'douyin', 'i1')).toBe(true)
      expect(store.getCreator('douyin', 'u1')?.handle).toBe('u1')

      const second = await importLegacy(root, store, { apply: true })
      expect(second).toMatchObject({ items: 1, comments: 2, refs: 1 })
      expect(store.usage()).toMatchObject({ items: 1, comments: 2, refs: 1 })

      const pruned = await importLegacy(root, store, { apply: true, pruneLegacy: true })
      expect(pruned.pruned.length).toBe(1)
      expect(await readFile(join(root, 'users', '管理员', '.legacy', 'douyin', 'search_item_2026-11-12.jsonl'), 'utf8')).toContain('i1')
    } finally { store.close() }
  })

  it('用户视图从引用回填共享内容，并遵守隐藏掩码', async () => {
    const root = await tempDir()
    const store = openContentStore(join(root, 'shared'))
    try {
      store.putItem('xhs', item('i1'), { body: 'full' })
      store.putComments('xhs', 'i1', [comment('c1'), comment('c2')], { limit: 0, complete: true })
      store.addRef('alice', 'xhs', 'i1', { jobId: 'j1' })
      resetRecordCache()

      const index = await loadIndex({ root: join(root, 'users', 'alice'), store, user: 'alice' }, 'xhs')
      expect(index.items).toHaveLength(1)
      expect(index.items[0]).toMatchObject({ id: 'i1', title: 'i1', comments: 2 })
      expect(index.comments.get('i1')).toHaveLength(2)

      // 隐藏一条后，同一个用户的视图立刻变少；共享库里仍然是两条。
      store.hideComments('alice', 'xhs', 'i1', ['c1'])
      resetRecordCache()
      const after = await loadIndex({ root: join(root, 'users', 'alice'), store, user: 'alice' }, 'xhs')
      expect(after.comments.get('i1')?.map((one) => one.id)).toEqual(['c2'])
      expect(store.commentCount('xhs', 'i1')).toBe(2)

      // 没有引用的人看不到这条。
      resetRecordCache()
      const bob = await loadIndex({ root: join(root, 'users', 'bob'), store, user: 'bob' }, 'xhs')
      expect(bob.items).toHaveLength(0)
    } finally { store.close() }
  })
})

describe('共享库 + Web 控制台', () => {
  const saved = { users: process.env.OMC_USERS_FILE, password: process.env.OMC_ADMIN_PASSWORD }
  afterEach(() => {
    if (saved.users === undefined) delete process.env.OMC_USERS_FILE; else process.env.OMC_USERS_FILE = saved.users
    if (saved.password === undefined) delete process.env.OMC_ADMIN_PASSWORD; else process.env.OMC_ADMIN_PASSWORD = saved.password
  })

  async function signIn(base: string, username = 'admin', password = 'adminpass123'): Promise<string> {
    const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    expect(response.status).toBe(200)
    return response.headers.get('set-cookie')!.split(';')[0]!
  }

  it('两个用户在同一控制台采同一个关键词：第二个零详情/评论请求，各自视图独立', async () => {
    const out = await tempDir('omc-shared-ui-')
    const home = await tempDir('omc-shared-ui-home-')
    process.env.OMC_USERS_FILE = join(home, 'users.json')
    process.env.OMC_ADMIN_PASSWORD = 'adminpass123'
    const calls: string[] = []
    const ui = await startUiServer({ port: 0, out, clientFactory: () => client(calls) })
    const base = `http://${ui.host}:${ui.port}`
    try {
      const admin = await signIn(base)
      const headers = (cookie: string) => ({ 'content-type': 'application/json', cookie })
      expect((await fetch(`${base}/api/users`, { method: 'POST', headers: headers(admin), body: JSON.stringify({ username: 'bob', password: 'bobpass123', role: 'user' }) })).status).toBe(201)
      const bob = await signIn(base, 'bob', 'bobpass123')

      const run = async (cookie: string): Promise<void> => {
        const created = await fetch(`${base}/api/jobs`, { method: 'POST', headers: headers(cookie), body: JSON.stringify({ platform: 'xhs', type: 'search', keywords: 'k', maxItems: 1, comments: true, sleep: '0' }) })
        expect(created.status).toBe(202)
        const { id } = await created.json() as { id: string }
        await (await fetch(`${base}/api/jobs/${id}/events`, { headers: { cookie } })).text()
      }

      calls.length = 0
      await run(admin)
      expect(calls.filter((call) => call.startsWith('detail'))).toHaveLength(1)
      expect(calls.filter((call) => call.startsWith('comments'))).toHaveLength(1)

      calls.length = 0
      await run(bob)
      expect(calls.filter((call) => call.startsWith('detail'))).toHaveLength(0)
      expect(calls.filter((call) => call.startsWith('comments'))).toHaveLength(0)

      const records = await (await fetch(`${base}/api/records?platform=xhs`, { headers: { cookie: bob } })).json() as { items: Array<{ id: string; comments: number }> }
      expect(records.items).toHaveLength(1)
      expect(records.items[0]).toMatchObject({ id: 'i1', comments: 2 })

      const stats = await (await fetch(`${base}/api/content/stats`, { headers: { cookie: admin } })).json() as { usage: { items: number; comments: number; refs: number }; reuse: { byKind: Record<string, { fetched: number; reused: number }> } }
      expect(stats.usage).toMatchObject({ items: 1, comments: 2, refs: 2 })
      expect(stats.reuse.byKind.item).toMatchObject({ fetched: 1, reused: 1 })
      expect((await fetch(`${base}/api/content/stats`, { headers: { cookie: bob } })).status).toBe(403)

      // 媒体接口：自己的作品没下载媒体 → 空清单；没有引用的作品 → 403。
      const ownList = await (await fetch(`${base}/api/media/list?platform=xhs&item=i1`, { headers: { cookie: bob } })).json() as { media: unknown[] }
      expect(ownList.media).toEqual([])
      expect((await fetch(`${base}/api/media/list?platform=xhs&item=i2`, { headers: { cookie: bob } })).status).toBe(403)
      const own = await fetch(`${base}/api/media?platform=xhs&item=i1&seq=1`, { headers: { cookie: bob } })
      expect(own.status).toBe(404)
      const other = await fetch(`${base}/api/media?platform=xhs&item=i2&seq=1`, { headers: { cookie: bob } })
      expect(other.status).toBe(403)

      // 回收：普通账号无权；admin 预览不删、执行要二次确认
      expect((await fetch(`${base}/api/content/gc?days=30`, { headers: { cookie: bob } })).status).toBe(403)
      const plan = await (await fetch(`${base}/api/content/gc?days=30`, { headers: { cookie: admin } })).json() as { items: unknown[]; applied: boolean }
      expect(plan.applied).toBe(false)
      expect(plan.items).toEqual([]) // 两条作品都被引用着，不能被回收
      expect((await fetch(`${base}/api/content/gc`, { method: 'POST', headers: headers(admin), body: JSON.stringify({ days: 30, confirm: 'no' }) })).status).toBe(400)
      const applied = await (await fetch(`${base}/api/content/gc`, { method: 'POST', headers: headers(admin), body: JSON.stringify({ days: 30, confirm: '确认回收' }) })).json() as { applied: boolean; items: unknown[] }
      expect(applied).toMatchObject({ applied: true, items: [] })
    } finally { await ui.close() }
  })
})
