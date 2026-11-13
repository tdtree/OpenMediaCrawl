import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLexicon, sanitizeLexicon, saveLexicon, splitTerms } from '../src/crawl/lexicon.js'
import { appendChat, hasMessage, listChat, listThreads } from '../src/crawl/chat.js'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omc-lex-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('词库', () => {
  it('按空格、斜杠、逗号、顿号、分号拆分，去空去重', () => {
    expect(splitTerms('消防 / 贷款，价格、批发; 消防')).toEqual(['消防', '贷款', '价格', '批发', '消防'])
    expect(sanitizeLexicon({ keywords: splitTerms('消防 / 贷款，价格、批发; 消防') }).keywords).toEqual(['消防', '贷款', '价格', '批发'])
    expect(sanitizeLexicon({ keywords: ['  ', 'a', 'a', 'b'], filters: 'x/y' })).toEqual({ keywords: ['a', 'b'], filters: ['x', 'y'] })
  })

  it('缺省/坏文件都当空词库，保存后可读回', async () => {
    const dir = await tempDir()
    expect(await loadLexicon(dir)).toEqual({ keywords: [], filters: [] })
    const saved = await saveLexicon(dir, { keywords: ['消防', '贷款'], filters: ['价格'] })
    expect(saved).toEqual({ keywords: ['消防', '贷款'], filters: ['价格'] })
    expect(await loadLexicon(dir)).toEqual(saved)
  })

  it('单项超长截断、总量封顶', () => {
    const long = 'x'.repeat(60)
    expect(sanitizeLexicon({ keywords: [long] }).keywords[0]).toHaveLength(40)
    const many = Array.from({ length: 400 }, (_, i) => `k${i}`)
    expect(sanitizeLexicon({ keywords: many }).keywords).toHaveLength(300)
  })
})

describe('私信记录', () => {
  it('按时间排序、按会话分组、能判重', async () => {
    const dir = await tempDir()
    const first = await appendChat(dir, { platform: 'douyin', peerId: 'u1', peerName: '张三', direction: 'out', text: '你好' })
    await new Promise((done) => setTimeout(done, 5))
    const second = await appendChat(dir, { platform: 'douyin', peerId: 'u1', direction: 'in', text: '在的' })
    await appendChat(dir, { platform: 'xhs', peerId: 'u2', direction: 'out', text: 'hi', status: 'failed' })

    const list = await listChat(dir, { platform: 'douyin', peerId: 'u1' })
    expect(list.map((m) => m.text)).toEqual(['你好', '在的'])
    expect(list[0]!.id).toBe(first.id)
    expect(list[1]!.id).toBe(second.id)

    const threads = await listThreads(dir)
    expect(threads).toHaveLength(2)
    expect(threads.find((t) => t.peerId === 'u1')).toMatchObject({ count: 2, peerName: '张三', last: { text: '在的', direction: 'in' } })
    expect(threads.find((t) => t.peerId === 'u2')!.last.status).toBe('failed')

    expect(await hasMessage(dir, { platform: 'douyin', peerId: 'u1', text: '你好', direction: 'out' })).toBe(true)
    expect(await hasMessage(dir, { platform: 'douyin', peerId: 'u1', text: '你好', direction: 'in' })).toBe(false)
  })

  it('坏行跳过，不影响其它消息', async () => {
    const dir = await tempDir()
    const { appendFile } = await import('node:fs/promises')
    await appendChat(dir, { platform: 'xhs', peerId: 'u9', direction: 'out', text: 'ok' })
    await appendFile(join(dir, 'chat.jsonl'), '{bad json\n', 'utf8')
    expect((await listChat(dir)).map((m) => m.text)).toEqual(['ok'])
  })
})
