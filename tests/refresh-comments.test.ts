import { describe, expect, it } from 'vitest'
import type { Comment } from '../src/core/schemas.js'
import { checkNewComments } from '../src/crawl/refresh-comments.js'

const comment = (id: string): Comment => ({
  id, item_id: 'i1', parent_id: null, author: { id: 'u1', name: '评论者', url: null },
  text: `评论 ${id}`, created_at: '2026-11-18T10:00:00+08:00', stats: { likes: 0, replies: 0 },
})

function fakeStore(initial: Comment[]) {
  const list = [...initial]
  const ids = () => new Set(list.map((one) => String(one.id)))
  return {
    list,
    putCalls: 0,
    refTouched: false,
    getItem: () => ({ data: { url: 'https://www.douyin.com/video/1' } }),
    commentCount: () => list.length,
    listComments: () => list.map((one) => ({ ...one, first_seen_at: Date.parse('2026-11-01T00:00:00Z') })),
    getCommentsState: () => ({ limit: 0, complete: true, withReplies: true, fetchedAt: 1 }),
    putComments: (_platform: string, _item: string, incoming: Comment[]) => {
      const known = ids()
      for (const one of incoming) if (!known.has(String(one.id))) list.push(one)
      return { added: incoming.length, total: list.length }
    },
    addRef: () => { /* touched */ },
  }
}

describe('checkNewComments', () => {
  it('翻到连续已知评论就停，只把新评论落库', async () => {
    const known = [comment('c1'), comment('c2'), comment('c3'), comment('c4'), comment('c5')]
    const store = fakeStore(known)
    const calls: Array<{ limit: number; cursor?: string | null }> = []
    const pages: Record<string, Comment[]> = {
      '': [comment('n1'), comment('c1'), comment('c2')],
      p2: [comment('c3'), comment('c4'), comment('c5')],
    }
    const client = {
      comments: async (_ref: string, limit: number, cursor?: string | null) => {
        calls.push({ limit, cursor })
        return cursor === 'p2'
          ? { items: pages.p2!, hasMore: false, cursor: null }
          : { items: pages['']!, hasMore: true, cursor: 'p2' }
      },
    } as any
    const result = await checkNewComments({ client, store: store as any, platform: 'douyin', itemId: 'i1', user: 'admin', pageSize: 3, stopAfterKnown: 3 })
    expect(result.added).toBe(1)
    expect(result.total).toBe(6)
    expect(result.pages).toBe(2)
    expect(result.stopped).toBe('known')
    expect(calls).toEqual([{ limit: 3, cursor: null }, { limit: 3, cursor: 'p2' }])
    expect(store.list.map((one) => one.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'n1'])
  })

  it('到末页时停止，并把 total 返回', async () => {
    const store = fakeStore([comment('c1')])
    const client = {
      comments: async () => ({ items: [comment('c1'), comment('n1')], hasMore: false, cursor: null }),
    } as any
    const result = await checkNewComments({ client, store: store as any, platform: 'douyin', itemId: 'i1', user: 'admin' })
    expect(result).toMatchObject({ added: 1, total: 2, pages: 1, stopped: 'end' })
  })
})
