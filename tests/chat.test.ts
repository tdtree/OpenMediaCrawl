import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendChat, findNear, hasMessage, listChat, parseMediaText } from '../src/crawl/chat.js'

const dirs: string[] = []
async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'catbus-chat-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

describe('聊天记录排序', () => {
  it('按真实时间升序，不按字符串比较（+08:00 与 Z 混用）', async () => {
    const r = await root()
    // 同一时刻的三种写法 + 一条更晚的：字符串直接比较会把 06:00Z 排到 14:00+08:00 前面
    await appendChat(r, { platform: 'douyin', peerId: 'p1', direction: 'out', text: 'A 14:00+08:00', at: '2026-11-17T14:00:00+08:00' })
    await appendChat(r, { platform: 'douyin', peerId: 'p1', direction: 'in', text: 'B 06:00Z(同一时刻)', at: '2026-11-17T06:00:00Z' })
    await appendChat(r, { platform: 'douyin', peerId: 'p1', direction: 'in', text: 'C 07:00Z(更晚)', at: '2026-11-17T07:00:00Z' })
    const list = await listChat(r, { platform: 'douyin', peerId: 'p1' })
    expect(list.map((m) => m.text)).toEqual(['A 14:00+08:00', 'B 06:00Z(同一时刻)', 'C 07:00Z(更晚)'])
  })

  it('时间无法解析的脏数据沉底，且不丢消息', async () => {
    const r = await root()
    await appendChat(r, { platform: 'xhs', peerId: 'p', direction: 'out', text: 'ok', at: '2026-11-17T10:00:00+08:00' })
    await appendChat(r, { platform: 'xhs', peerId: 'p', direction: 'in', text: '脏时间', at: '不是时间' })
    const list = await listChat(r, { platform: 'xhs', peerId: 'p' })
    expect(list).toHaveLength(2)
    expect(list[0]!.text).toBe('ok')
    expect(list[1]!.text).toBe('脏时间')
  })
})

describe('聊天记录媒体', () => {
  it('appendChat 存下 media，listChat 原样读回', async () => {
    const r = await root()
    await appendChat(r, {
      platform: 'xhs',
      peerId: 'p',
      direction: 'in',
      text: '',
      status: 'received',
      media: [{ type: 'image', url: 'https://example.test/a.jpg' }],
    })
    const [one] = await listChat(r, { platform: 'xhs', peerId: 'p' })
    expect(one?.media).toEqual([{ type: 'image', url: 'https://example.test/a.jpg' }])
    expect(one?.text).toBe('')
  })

  it('没有 media 时不写多余字段', async () => {
    const r = await root()
    await appendChat(r, { platform: 'xhs', peerId: 'p', direction: 'out', text: 'hi' })
    const [one] = await listChat(r, { platform: 'xhs', peerId: 'p' })
    expect(one?.media).toBeUndefined()
  })
})

describe('正文是 JSON 的图片消息', () => {
  // 真实样本：小红书历史里图片消息的 content 就长这样
  const content = JSON.stringify({
    asset_length: 190400,
    comment: '',
    commentJumpLink: '',
    imageDataMap: {
      IM_ORG: { imageScene: 'IM_ORG', url: 'https://msg-img.xhscdn.com/aaa?imageView2/format/webp/q/90' },
      IM_PRV: { imageScene: 'IM_PRV', url: 'https://msg-img.xhscdn.com/aaa?imageView2/2/w/640/format/webp/q/85' },
      IM_DTL: { imageScene: 'IM_DTL', url: 'https://msg-img.xhscdn.com/aaa?imageView2/2/w/1080/format/webp/q/85' },
    },
    imageFileId: '1040g07o327log3op706g48m04f8qbvde0hs7koo',
    link: 'https://msg-img.xhscdn.com/aaa?imageView2/2/format/jpg',
    md5: '68f233f8f46b562ae0af3018e6605872',
    originSize: 190400,
    size: { height: 1394, width: 1128 },
  })

  it('抽出 IM_PRV 作为唯一图片，正文清空', () => {
    const out = parseMediaText(content)
    expect(out.text).toBe('')
    expect(out.media).toHaveLength(1)
    expect(out.media[0]!.url).toContain('w/640')
  })

  it('普通文本原样返回，不会被误判', () => {
    for (const text of ['test', '留个', '{"foo":1}', '']) {
      const out = parseMediaText(text)
      expect(out.media).toEqual([])
      expect(out.text).toBe(text.trim())
    }
  })

  it('listChat 读旧数据时也能还原（不需要迁移文件）', async () => {
    const r = await root()
    // 模拟旧版本写进去的样子：正文就是那段 JSON，没有 media 字段
    await appendChat(r, { platform: 'xhs', peerId: 'p', direction: 'in', text: content, status: 'received' })
    const [one] = await listChat(r, { platform: 'xhs', peerId: 'p' })
    expect(one?.text).toBe('')
    expect(one?.media?.[0]?.url).toContain('msg-img.xhscdn.com')
  })
})

describe('去重与时间修正', () => {
  it('同一句话时间差 5 分钟算同一条（发送记录 vs 平台历史）', async () => {
    const r = await root()
    await appendChat(r, { platform: 'xhs', peerId: 'p', direction: 'out', text: 'test', at: '2026-11-17T14:58:00+08:00' })
    expect(await hasMessage(r, { platform: 'xhs', peerId: 'p', text: 'test', direction: 'out', at: '2026-11-17T15:03:00+08:00', withinMs: 10 * 60 * 1000 })).toBe(true)
    // 不传容差时仍是精确到分钟的老行为
    expect(await hasMessage(r, { platform: 'xhs', peerId: 'p', text: 'test', direction: 'out', at: '2026-11-17T15:03:00+08:00' })).toBe(false)
  })

  it('findNear 能定位到需要修正时间的那条', async () => {
    const r = await root()
    const created = await appendChat(r, { platform: 'xhs', peerId: 'p', direction: 'in', text: '留个', at: '2026-11-17T15:16:30+08:00' })
    const near = await findNear(r, { platform: 'xhs', peerId: 'p', text: '留个', direction: 'in', at: '2026-11-17T15:16:00+08:00', withinMs: 10 * 60 * 1000 })
    expect(near?.id).toBe(created.id)
  })

  it('方向不同的同文本不会被当成同一条', async () => {
    const r = await root()
    await appendChat(r, { platform: 'xhs', peerId: 'p', direction: 'out', text: 'test', at: '2026-11-17T14:58:00+08:00' })
    expect(await hasMessage(r, { platform: 'xhs', peerId: 'p', text: 'test', direction: 'in', at: '2026-11-17T14:58:30+08:00', withinMs: 600000 })).toBe(false)
  })
})
