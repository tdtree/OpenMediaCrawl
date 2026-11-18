import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Candidate } from '../src/crawl/candidates.js'
import type { SentRecord } from '../src/crawl/guard.js'
import { annotateLeads, dmSentAt, indexPool, indexSent, leadInPool, loadLeadStatus } from '../src/crawl/lead-status.js'
import { LeadStore, type Lead } from '../src/crawl/leads.js'

const dirs: string[] = []
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omc-lead-status-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const sent = (over: Partial<SentRecord> = {}): SentRecord => ({ platform: 'douyin', target: 'u1', kind: 'dm', at: '2026-11-01T10:00:00+08:00', ok: true, ...over })
const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'c1', type: 'dm', platform: 'douyin', itemId: 'i1', commentId: null, userId: 'u1', userName: '张三', note: null, added_at: '2026-11-01T10:00:00+08:00', ...over,
})
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'douyin:cm1', platform: 'douyin', comment_id: 'cm1', item_id: 'i1', item_title: '作品一', item_url: null,
  author_id: 'u1', author_name: '张三', text: '多少钱？', created_at: '2026-11-01T09:00:00+08:00', province: '广东',
  matched: [], contacts: [], collected_at: '2026-11-02T10:00:00+08:00', ...over,
})

describe('indexSent', () => {
  it('只认成功的私信，失败的和评论回复都不算', () => {
    const index = indexSent([
      sent({ target: 'u1' }),
      sent({ target: 'u2', ok: false }),
      sent({ target: 'u3', kind: 'reply' }),
    ])
    expect([...index.keys()]).toEqual(['douyin:u1'])
  })

  it('同一个人取最近一次发送时间', () => {
    const index = indexSent([
      sent({ at: '2026-11-03T10:00:00+08:00' }),
      sent({ at: '2026-11-01T10:00:00+08:00' }),
      sent({ at: '2026-11-02T10:00:00+08:00' }),
    ])
    expect(index.get('douyin:u1')).toBe('2026-11-03T10:00:00+08:00')
  })

  it('平台不同的同 id 互不影响', () => {
    const index = indexSent([sent({ platform: 'douyin' }), sent({ platform: 'xhs', at: '2026-11-05T10:00:00+08:00' })])
    expect(dmSentAt({ dmSentAt: index, inPool: new Set() }, 'douyin', 'u1')).toBe('2026-11-01T10:00:00+08:00')
    expect(dmSentAt({ dmSentAt: index, inPool: new Set() }, 'xhs', 'u1')).toBe('2026-11-05T10:00:00+08:00')
    expect(dmSentAt({ dmSentAt: index, inPool: new Set() }, 'weibo', 'u1')).toBeNull()
  })

  it('空 target / 空 platform 不建键', () => {
    expect(indexSent([sent({ target: '  ' }), sent({ platform: '' })]).size).toBe(0)
  })

  it('坏时间不覆盖已有的最新时间', () => {
    const index = indexSent([sent({ at: '2026-11-03T10:00:00+08:00' }), sent({ at: '不是时间' })])
    expect(index.get('douyin:u1')).toBe('2026-11-03T10:00:00+08:00')
  })
})

describe('indexPool', () => {
  it('私信候选记 userId，回复候选记 commentId', () => {
    const index = indexPool([candidate(), candidate({ id: 'c2', type: 'reply', userId: null, commentId: 'cm9' })])
    expect([...index].sort()).toEqual(['douyin:cm9', 'douyin:u1'])
  })
})

describe('annotateLeads', () => {
  const empty = { dmSentAt: new Map<string, string>(), inPool: new Set<string>() }

  it('作者发过私信就带 dm_sent_at，没发过就不带这个字段', () => {
    const index = { ...empty, dmSentAt: new Map([['douyin:u1', '2026-11-03T10:00:00+08:00']]) }
    const [hit, miss] = annotateLeads([lead(), lead({ id: 'douyin:cm2', comment_id: 'cm2', author_id: 'u2' })], index)
    expect(hit!.dm_sent_at).toBe('2026-11-03T10:00:00+08:00')
    expect('dm_sent_at' in miss!).toBe(false)
  })

  it('入池：私信候选按作者、回复候选按评论 id 都能命中', () => {
    const byUser = annotateLeads([lead()], { ...empty, inPool: new Set(['douyin:u1']) })
    expect(byUser[0]!.in_pool).toBe(true)
    const byComment = annotateLeads([lead()], { ...empty, inPool: new Set(['douyin:cm1']) })
    expect(byComment[0]!.in_pool).toBe(true)
    expect('in_pool' in annotateLeads([lead()], empty)[0]!).toBe(false)
  })

  it('作者是 null 时不拿 comment_id 去撞私信索引', () => {
    const index = { ...empty, inPool: new Set<string>() }
    const [one] = annotateLeads([lead({ author_id: null })], index)
    expect('dm_sent_at' in one!).toBe(false)
  })

  it('不改入参', () => {
    const source = lead()
    const index = { dmSentAt: new Map([['douyin:u1', '2026-11-03T10:00:00+08:00']]), inPool: new Set(['douyin:u1']) }
    const [out] = annotateLeads([source], index)
    expect(source).not.toHaveProperty('dm_sent_at')
    expect(source).not.toHaveProperty('in_pool')
    expect(out).not.toBe(source)
  })

  it('leadInPool 平台不同不算命中', () => {
    expect(leadInPool({ ...empty, inPool: new Set(['xhs:u1']) }, lead())).toBe(false)
  })
})

describe('loadLeadStatus', () => {
  it('一次读齐账本与候选池，按索引关联到线索', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'sent.jsonl'), [
      JSON.stringify({ platform: 'douyin', target: 'u1', kind: 'dm', at: '2026-11-01T10:00:00+08:00', ok: true }),
      JSON.stringify({ platform: 'douyin', target: 'u1', kind: 'dm', at: '2026-11-04T10:00:00+08:00', ok: true }),
      JSON.stringify({ platform: 'douyin', target: 'u2', kind: 'dm', at: '2026-11-04T10:00:00+08:00', ok: false }),
      '这不是 JSON',
    ].join('\n') + '\n', 'utf8')
    await writeFile(join(root, 'candidates.json'), JSON.stringify({ version: 1, items: [candidate({ userId: 'u3' })] }), 'utf8')

    const index = await loadLeadStatus(root)
    expect(index.dmSentAt.get('douyin:u1')).toBe('2026-11-04T10:00:00+08:00')
    expect(index.dmSentAt.has('douyin:u2')).toBe(false)
    expect([...index.inPool]).toEqual(['douyin:u3'])

    const [one, two] = annotateLeads([lead(), lead({ id: 'douyin:cm2', comment_id: 'cm2', author_id: 'u3' })], index)
    expect(one).toMatchObject({ dm_sent_at: '2026-11-04T10:00:00+08:00' })
    expect('in_pool' in one!).toBe(false)
    expect(two).toMatchObject({ in_pool: true })
    expect('dm_sent_at' in two!).toBe(false)
  })

  it('两个文件都不存在时索引为空', async () => {
    const index = await loadLeadStatus(await tempRoot())
    expect(index.dmSentAt.size).toBe(0)
    expect(index.inPool.size).toBe(0)
  })

  it('线索文件不会被写回这两个字段', async () => {
    const root = await tempRoot()
    const file = join(root, 'leads.jsonl')
    await new LeadStore(file).upsert([lead()])
    const index = { dmSentAt: new Map([['douyin:u1', '2026-11-04T10:00:00+08:00']]), inPool: new Set(['douyin:u1']) }
    const annotated = annotateLeads(await new LeadStore(file).load(), index)
    expect(annotated[0]).toMatchObject({ dm_sent_at: '2026-11-04T10:00:00+08:00', in_pool: true })
    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain('dm_sent_at')
    expect(raw).not.toContain('in_pool')
  })
})
