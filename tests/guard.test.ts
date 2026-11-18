import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accountStatus, DEFAULT_DAILY_CAP, SendLedger } from '../src/crawl/guard.js'

// 每个用例一个独立临时目录：账本文件和假 CLI 都放里面，互不干扰。
let dir = ''
let ledgerFile = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omc-guard-'))
  ledgerFile = join(dir, 'sent.jsonl')
})

afterEach(async () => {
  // Windows 上子进程刚被杀掉时文件可能还短暂占用，交给 rm 重试。
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function ledger(): SendLedger {
  return new SendLedger(ledgerFile)
}

/** 写一个假 CLI：忽略传入参数，只按脚本体输出。 */
async function fakeBin(name: string, body: string): Promise<string> {
  const file = join(dir, name)
  await writeFile(file, body, 'utf8')
  return file
}

const OK_ENVELOPE = `{
  ok: true,
  platform: 'douyin',
  endpoint: null,
  resource: 'auth',
  action: 'status',
  account: null,
  data: { logged_in: true, user: { id: 'u-1', name: '阿猫' }, method: 'cookie' },
  page: null,
  error: null,
}`

async function lines(file: string): Promise<string[]> {
  return (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean)
}

describe('SendLedger 记账', () => {
  it('失败的发送不算已发送，可以重试', async () => {
    const store = ledger()
    await store.record({ platform: 'douyin', target: 'comment-1', kind: 'reply', ok: false })

    await expect(store.isSent('douyin', 'comment-1', 'reply')).resolves.toBe(false)
    await expect(store.canSend('douyin', 'comment-1', 'reply')).resolves.toEqual({ ok: true })
    await expect(store.sentToday('douyin')).resolves.toBe(0)

    const saved = await store.records()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.ok).toBe(false)
  })

  it('成功发送后再发同一条被拒', async () => {
    const store = ledger()
    await store.record({ platform: 'douyin', target: 'comment-1', kind: 'reply', ok: true })

    await expect(store.isSent('douyin', 'comment-1', 'reply')).resolves.toBe(true)
    await expect(store.canSend('douyin', 'comment-1', 'reply')).resolves.toEqual({
      ok: false,
      reason: '已发送过',
    })
    await expect(store.sentToday('douyin')).resolves.toBe(1)
  })

  it('平台、目标、类型任一不同都不算已发送', async () => {
    const store = ledger()
    await store.record({ platform: 'douyin', target: 'comment-1', kind: 'reply', ok: true })

    await expect(store.isSent('xhs', 'comment-1', 'reply')).resolves.toBe(false)
    await expect(store.isSent('douyin', 'comment-2', 'reply')).resolves.toBe(false)
    await expect(store.isSent('douyin', 'comment-1', 'dm')).resolves.toBe(false)
  })

  it('一行一条 jsonl，at 默认是带本地时区偏移的 ISO 8601', async () => {
    const store = ledger()
    await store.record({ platform: 'douyin', target: 'comment-1', kind: 'reply', ok: true })
    await store.record({ platform: 'xhs', target: 'user-9', kind: 'dm', ok: false })

    const rows = await lines(ledgerFile)
    expect(rows).toHaveLength(2)
    const first = JSON.parse(rows[0]!) as { at: string; platform: string }
    expect(first.platform).toBe('douyin')
    expect(first.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect((await store.records())[0]?.at).toBe(first.at)
  })

  it('坏行不影响读取，重写时被丢弃', async () => {
    const good = JSON.stringify({ platform: 'douyin', target: 'a', kind: 'reply', at: '2026-11-12T10:00:00+08:00', ok: true })
    const alsoGood = JSON.stringify({ platform: 'douyin', target: 'b', kind: 'dm', at: '2026-11-12T11:00:00+08:00', ok: false })
    await writeFile(
      ledgerFile,
      [good, '', '这不是 JSON', '{"platform":"douyin"}', '[1,2]', alsoGood, '   '].join('\n'),
      'utf8',
    )

    const store = ledger()
    const records = await store.records()
    expect(records.map((record) => record.target)).toEqual(['a', 'b'])
    await expect(store.isSent('douyin', 'a', 'reply')).resolves.toBe(true)

    // 追加时按有效记录整体重写，坏行自然消失。
    await store.record({ platform: 'xhs', target: 'c', kind: 'dm', ok: true })
    const rows = await lines(ledgerFile)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(() => JSON.parse(row)).not.toThrow()
  })

  it('按本地日期统计今天的发送数', async () => {
    const store = ledger()
    await store.record({ platform: 'douyin', target: 'a', kind: 'reply', at: '2026-11-12T09:00:00+08:00', ok: true })
    await store.record({ platform: 'douyin', target: 'b', kind: 'reply', at: '2026-11-12T23:59:00+08:00', ok: true })
    await store.record({ platform: 'douyin', target: 'c', kind: 'reply', at: '2026-11-11T23:00:00+08:00', ok: true })
    await store.record({ platform: 'douyin', target: 'd', kind: 'reply', at: '2026-11-12T10:00:00+08:00', ok: false })

    await expect(store.sentToday('douyin', new Date('2026-11-12T12:00:00+08:00'))).resolves.toBe(2)
    await expect(store.sentToday('douyin', new Date('2026-11-11T12:00:00+08:00'))).resolves.toBe(1)
    await expect(store.sentToday('xhs', new Date('2026-11-12T12:00:00+08:00'))).resolves.toBe(0)
  })

  it('超过注入的单日上限被拒，第二天恢复', async () => {
    const store = ledger()
    const today = new Date('2026-11-12T12:00:00+08:00')
    const tomorrow = new Date('2026-11-13T00:10:00+08:00')
    for (const target of ['a', 'b']) {
      await store.record({ platform: 'douyin', target, kind: 'reply', at: '2026-11-12T10:00:00+08:00', ok: true })
    }

    await expect(store.canSend('douyin', 'c', 'reply', { dailyCap: 2, now: today })).resolves.toEqual({
      ok: false,
      reason: '今天已到上限',
    })
    // 换平台不受影响：上限按平台分别计算。
    await expect(store.canSend('xhs', 'c', 'reply', { dailyCap: 2, now: today })).resolves.toEqual({ ok: true })
    // 换一天计数从零开始。
    await expect(store.canSend('douyin', 'c', 'reply', { dailyCap: 2, now: tomorrow })).resolves.toEqual({ ok: true })
  })

  it('默认单日上限是 20 条', async () => {
    const store = ledger()
    const now = new Date('2026-11-12T12:00:00+08:00')
    for (let i = 0; i < DEFAULT_DAILY_CAP; i++) {
      await store.record({ platform: 'douyin', target: `t-${i}`, kind: 'reply', at: '2026-11-12T08:00:00+08:00', ok: true })
    }

    await expect(store.sentToday('douyin', now)).resolves.toBe(DEFAULT_DAILY_CAP)
    await expect(store.canSend('douyin', 'target-new', 'reply', { now })).resolves.toEqual({
      ok: false,
      reason: '今天已到上限',
    })
  })

  it('并发记账不丢记录', async () => {
    const store = ledger()
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.record({ platform: 'douyin', target: `c-${i}`, kind: 'reply', ok: true })),
    )

    const records = await store.records()
    expect(records).toHaveLength(10)
    expect(new Set(records.map((record) => record.target)).size).toBe(10)
  })

  it('clear 清空账本，重复清空不报错', async () => {
    const store = ledger()
    await store.record({ platform: 'douyin', target: 'a', kind: 'reply', ok: true })

    await store.clear()
    await expect(store.records()).resolves.toEqual([])
    await expect(store.isSent('douyin', 'a', 'reply')).resolves.toBe(false)
    await expect(store.clear()).resolves.toBeUndefined()
  })
})

describe('accountStatus', () => {
  it('解析 ok 信封里的登录态', async () => {
    const bin = await fakeBin('ok.mjs', `console.log(JSON.stringify(${OK_ENVELOPE}))\n`)
    await expect(accountStatus('douyin', { bin })).resolves.toEqual({
      logged_in: true,
      user: '阿猫',
      method: 'cookie',
    })
  })

  it('未登录（ok=true 但 logged_in=false）也照实返回', async () => {
    const bin = await fakeBin(
      'guest.mjs',
      `console.log(JSON.stringify({ ok: true, data: { logged_in: false, user: null, method: null } }))\n`,
    )
    await expect(accountStatus('douyin', { bin })).resolves.toEqual({
      logged_in: false,
      user: null,
      method: null,
    })
  })

  it('支持 MEDIACRAWL_BIN 覆盖默认入口', async () => {
    const bin = await fakeBin('env-bin.mjs', `console.log(JSON.stringify(${OK_ENVELOPE}))\n`)
    const result = await accountStatus('douyin', { env: { ...process.env, MEDIACRAWL_BIN: bin } })
    expect(result.logged_in).toBe(true)
    expect(result.user).toBe('阿猫')
  })

  it('子进程退出码 1 时返回未登录且不抛错', async () => {
    const bin = await fakeBin(
      'fail.mjs',
      `console.log(JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', message: '需要先登录' } }))\nprocess.exit(1)\n`,
    )
    const result = await accountStatus('douyin', { bin })
    expect(result).toMatchObject({ logged_in: false, user: null, method: null })
    expect(result.message).toContain('需要先登录')
  })

  it('输出不是 JSON 信封时返回未登录', async () => {
    const bin = await fakeBin('garbage.mjs', `console.log('这不是 JSON')\n`)
    const result = await accountStatus('douyin', { bin })
    expect(result.logged_in).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('超时返回未登录（timeoutMs=100）', async () => {
    const bin = await fakeBin(
      'slow.mjs',
      `setTimeout(() => { console.log(JSON.stringify({ ok: true, data: { logged_in: true } })) }, 5000)\n`,
    )
    const started = Date.now()
    const result = await accountStatus('douyin', { bin, timeoutMs: 100 })
    expect(result).toMatchObject({ logged_in: false, user: null, method: null })
    expect(result.message).toContain('超时')
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it('失败记录会带上错误码和原因，成功记录不写这两个字段', async () => {
    const store = ledger()
    await store.record({ platform: 'douyin', target: 'u1', kind: 'dm', ok: false, code: 'AUTH_EXPIRED', message: '凭证已过期' })
    await store.record({ platform: 'douyin', target: 'u2', kind: 'dm', ok: true })
    const raw = await readFile(ledgerFile, 'utf8')
    const rows = raw.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(rows[0]).toMatchObject({ target: 'u1', ok: false, code: 'AUTH_EXPIRED', message: '凭证已过期' })
    // 成功的那条不带多余字段，账本不会因为多两个 null 膨胀
    expect(rows[1]).not.toHaveProperty('code')
    expect(rows[1]).not.toHaveProperty('message')
  })
})
