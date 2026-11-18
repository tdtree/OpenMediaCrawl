import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadIndex, recordCacheStats, resetRecordCache, threadOf } from '../src/crawl/records.js'
import { addCandidate, clearCandidates, listCandidates, removeCandidate } from '../src/crawl/candidates.js'
import { runCampaign } from '../src/crawl/campaign.js'
import type { Candidate } from '../src/crawl/candidates.js'

const tmp: string[] = []
async function tempDir(prefix: string): Promise<string> { const dir = await mkdtemp(join(tmpdir(), prefix)); tmp.push(dir); return dir }
afterEach(async () => { for (const dir of tmp.splice(0)) await rm(dir, { recursive: true, force: true }); resetRecordCache() })

const comment = (id: string, itemId: string, parentId: string | null = null, text = `评论 ${id}`) => ({ id, item_id: itemId, parent_id: parentId, author: { id: `u-${id}`, name: `作者${id}`, url: null }, text, created_at: '2026-11-12T10:00:00+08:00', stats: { likes: 1, replies: 0 } })
const item = (id: string) => ({ id, kind: 'video', title: `作品 ${id}`, text: '', url: `https://www.douyin.com/video/${id}`, cover: null, author: { id: 'a1', name: '作者' }, created_at: '2026-11-11T10:00:00+08:00', stats: { views: 1, likes: 2, comments: 3, collects: 4, shares: 5 } })

describe('records index', () => {
  it('splits items and comments, nests replies, and caches on signature', async () => {
    const root = await tempDir('omc-rec-')
    await mkdir(join(root, 'douyin'), { recursive: true })
    await writeFile(join(root, 'douyin', 'search_item_2026-11-12.jsonl'), [item('i1'), item('i2')].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
    await writeFile(join(root, 'douyin', 'search_comment_2026-11-12.jsonl'), [comment('c1', 'i1'), comment('c2', 'i1', 'c1'), comment('c3', 'i2')].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
    const index = await loadIndex(root, 'douyin')
    expect(index.items.map((x) => x.id).sort()).toEqual(['i1', 'i2'])
    expect(index.items.find((x) => x.id === 'i1')!.comments).toBe(2)
    const thread = threadOf(index.comments.get('i1')!)
    expect(thread).toHaveLength(1)
    expect(thread[0]!.children.map((c) => c.id)).toEqual(['c2'])
    expect(await loadIndex(root, 'douyin')).toBe(index) // 同一个缓存对象
    await writeFile(join(root, 'douyin', 'search_comment_2026-11-12.jsonl'), [comment('c1', 'i1'), comment('c2', 'i1', 'c1'), comment('c3', 'i2'), comment('c4', 'i2')].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
    expect((await loadIndex(root, 'douyin')).comments.get('i2')).toHaveLength(2)
  })

  it('cache 有上限并按 LRU 淘汰，命中会刷新位置', async () => {
    process.env.OMC_RECORDS_CACHE_MAX = '2'
    try {
      const a = await tempDir('omc-lru-a-')
      const b = await tempDir('omc-lru-b-')
      const c = await tempDir('omc-lru-c-')
      const ia = await loadIndex(a, 'xhs')
      const ib = await loadIndex(b, 'xhs')
      expect(recordCacheStats()).toEqual({ size: 2, max: 2 })

      // 命中 A，把 B 挤到最旧；再加载 C 时应该淘汰 B。
      expect(await loadIndex(a, 'xhs')).toBe(ia)
      await loadIndex(c, 'xhs')
      expect(recordCacheStats().size).toBe(2)
      expect(await loadIndex(a, 'xhs')).toBe(ia)
      expect(await loadIndex(b, 'xhs')).not.toBe(ib)
    } finally {
      delete process.env.OMC_RECORDS_CACHE_MAX
      resetRecordCache()
    }
  })
})

describe('candidates', () => {
  it('dedupes, removes and clears by type', async () => {
    const root = await tempDir('omc-cand-')
    const first = await addCandidate(root, { type: 'reply', platform: 'douyin', itemId: 'i1', commentId: 'c1', userId: 'u1' })
    expect(first.added).toBe(true)
    const again = await addCandidate(root, { type: 'reply', platform: 'douyin', itemId: 'i1', commentId: 'c1', userId: 'u1' })
    expect(again.added).toBe(false)
    await addCandidate(root, { type: 'dm', platform: 'douyin', itemId: 'i1', commentId: 'c2', userId: 'u2' })
    expect((await listCandidates(root)).map((c) => c.type).sort()).toEqual(['dm', 'reply'])
    expect(await removeCandidate(root, first.candidate.id)).toBe(true)
    expect(await clearCandidates(root, 'dm')).toBe(1)
    expect(await listCandidates(root)).toHaveLength(0)
  })
})

describe('campaign runner', () => {
  const candidates: Candidate[] = [1, 2, 3].map((n) => ({ id: `c${n}`, type: 'reply', platform: 'douyin', itemId: 'i1', commentId: `cm${n}`, userId: null, userName: `人${n}`, note: null, added_at: '' }))

  it('waits a random interval between sends (not before the first)', async () => {
    const waits: number[] = []
    const result = await runCampaign(candidates, '你好', { minSeconds: 10, maxSeconds: 20, signal: new AbortController().signal }, {
      send: async () => ({ ok: true }),
      sleep: async (ms) => { waits.push(ms) },
      random: () => 0.5,
    }, () => {})
    expect(waits).toEqual([15000, 15000])
    expect(result).toMatchObject({ sent: 3, failed: 0, status: 'done' })
  })

  it('stops on risk control and does not keep sending', async () => {
    const waits: number[] = []
    let calls = 0
    const result = await runCampaign(candidates, '你好', { minSeconds: 5, maxSeconds: 5, signal: new AbortController().signal }, {
      send: async () => { calls++; return calls === 2 ? { ok: false, code: 'RISK_CONTROL', message: '验证码' } : { ok: true } },
      sleep: async (ms) => { waits.push(ms) },
    }, () => {})
    expect(calls).toBe(2)
    expect(result.status).toBe('stopped')
    expect(result.sent).toBe(1)
  })

  it('stops after three consecutive failures and honours the abort signal', async () => {
    const failed = await runCampaign(candidates, 'x', { minSeconds: 5, maxSeconds: 5, signal: new AbortController().signal }, {
      send: async () => ({ ok: false, code: 'UPSTREAM', message: '网络' }),
      sleep: async () => {},
    }, () => {})
    expect(failed).toMatchObject({ status: 'stopped', failed: 3 })

    const controller = new AbortController()
    const aborted = await runCampaign(candidates, 'x', { minSeconds: 5, maxSeconds: 5, signal: controller.signal }, {
      send: async () => { controller.abort(); return { ok: true } },
      sleep: async () => {},
    }, () => {})
    expect(aborted.status).toBe('stopped')
    expect(aborted.sent).toBe(1)
  })
})
