import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACTION_PLATFORMS, resetActionLimiter, runAction, type ActionDeps, type ActionInput, type ActionResult } from '../src/crawl/actions.js'

const dirs: string[] = []
async function tempDir(prefix: string): Promise<string> { const d = await mkdtemp(join(tmpdir(), prefix)); dirs.push(d); return d }

/** 假 CLI：把收到的参数回写到信封的 data.argv 里，用来断言命令拼接。 */
async function fakeBin(payload: Record<string, unknown> = { ok: true }, code = 0): Promise<string> {
  const dir = await tempDir('omc-action-bin-')
  const path = join(dir, 'fake-action.mjs')
  await writeFile(path, `process.stdout.write(JSON.stringify({ ...${JSON.stringify(payload)}, data: { ...${JSON.stringify(payload.data ?? {})}, argv: process.argv.slice(2) } })); process.exit(${code})`, 'utf8')
  return path
}

/** 永远不返回的子进程，用来测超时。 */
async function slowBin(): Promise<string> {
  const dir = await tempDir('omc-action-slow-')
  const path = join(dir, 'slow-action.mjs')
  await writeFile(path, 'setTimeout(() => {}, 5000)', 'utf8')
  return path
}

/** 不写信封、只写 stderr 的失败子进程。 */
async function brokenBin(): Promise<string> {
  const dir = await tempDir('omc-action-broken-')
  const path = join(dir, 'broken-action.mjs')
  await writeFile(path, "process.stderr.write('boom: network down\\n'); process.exit(7)", 'utf8')
  return path
}

const savedEnv = new Map<string, string | undefined>()
function setEnv(key: string, value: string | undefined): void {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function argvOf(result: ActionResult): string[] {
  if (!result.ok) throw new Error(`应当成功，实际失败：${result.code} ${result.message}`)
  return (result.data as { argv: string[] }).argv
}

function expectFail(result: ActionResult, code: string): string {
  if (result.ok) throw new Error(`应当失败，实际成功：${JSON.stringify(result.data)}`)
  expect(result.code).toBe(code)
  return result.message
}

const base = (over: Partial<ActionInput> = {}): ActionInput => ({ platform: 'douyin', kind: 'comment', target: '7123', text: '拍得真好', ...over })
const deps = (bin: string, over: Partial<ActionDeps> = {}): ActionDeps => ({ bin, now: () => 0, ...over })

beforeEach(() => { resetActionLimiter() })
afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnv.clear()
  resetActionLimiter()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('action platform whitelist', () => {
  it('只有 CLI 里真做出来的平台在册', () => {
    expect([...ACTION_PLATFORMS.comment]).toEqual(['douyin', 'bilibili'])
    expect([...ACTION_PLATFORMS.dm]).toEqual(['douyin', 'xhs', 'tiktok', 'xianyu', 'taobao', 'jd'])
  })

  it('平台不在白名单时报 UNSUPPORTED', async () => {
    const bin = await fakeBin()
    expect(expectFail(await runAction(base({ platform: 'xhs' }), deps(bin)), 'UNSUPPORTED')).toBe('xhs 不支持发评论')
    expect(expectFail(await runAction(base({ platform: 'kuaishou' }), deps(bin)), 'UNSUPPORTED')).toBe('kuaishou 不支持发评论')
    expect(expectFail(await runAction(base({ platform: 'bilibili', kind: 'dm' }), deps(bin)), 'UNSUPPORTED')).toBe('bilibili 不支持发私信')
  })
})

describe('action command assembly', () => {
  it('发评论：<平台> comment add <作品> <正文> -o json', async () => {
    const bin = await fakeBin()
    expect(argvOf(await runAction(base({ text: '  拍得真好  ' }), deps(bin)))).toEqual(['douyin', 'comment', 'add', '7123', '拍得真好', '-o', 'json'])
  })

  it('发私信：<平台> msg send <正文> --to <对方> -o json', async () => {
    const bin = await fakeBin()
    const argv = argvOf(await runAction(base({ platform: 'xhs', kind: 'dm', target: 'user-9', text: '在的' }), deps(bin)))
    expect(argv).toEqual(['xhs', 'msg', 'send', '在的', '--to', 'user-9', '-o', 'json'])
  })

  it('replyTo 映射到 --reply-to', async () => {
    const bin = await fakeBin()
    const argv = argvOf(await runAction(base({ replyTo: 'c-9' }), deps(bin)))
    expect(argv).toEqual(['douyin', 'comment', 'add', '7123', '拍得真好', '--reply-to', 'c-9', '-o', 'json'])
  })

  it('account 映射到 -a，紧跟在平台后面', async () => {
    const bin = await fakeBin()
    expect(argvOf(await runAction(base({ account: 'acc2' }), deps(bin)))).toEqual(['douyin', '-a', 'acc2', 'comment', 'add', '7123', '拍得真好', '-o', 'json'])
    expect(argvOf(await runAction(base({ kind: 'dm', platform: 'jd', account: 'acc2', target: 'u1', text: 'hi' }), deps(bin)))).toEqual(['jd', '-a', 'acc2', 'msg', 'send', 'hi', '--to', 'u1', '-o', 'json'])
  })

  it('成功的返回值带上信封里的 data', async () => {
    const bin = await fakeBin({ ok: true, data: { id: 'c1', text: '好' } })
    const result = await runAction(base(), deps(bin))
    expect(result.ok && result.data).toMatchObject({ id: 'c1', text: '好' })
  })

  it('没传 deps.bin 时读 MEDIACRAWL_BIN', async () => {
    setEnv('MEDIACRAWL_BIN', await fakeBin())
    expect(argvOf(await runAction(base({ kind: 'dm', target: 'u1', text: 'hi' }), { now: () => 0 }))).toEqual(['douyin', 'msg', 'send', 'hi', '--to', 'u1', '-o', 'json'])
  })
})

describe('action input validation', () => {
  it('空文本 / 超长文本报 USAGE，且不会拉起子进程', async () => {
    const missing = join(await tempDir('omc-action-none-'), 'nope.mjs')
    expect(expectFail(await runAction(base({ text: '   ' }), deps(missing)), 'USAGE')).toContain('不能为空')
    expect(expectFail(await runAction(base({ text: '\n\t' }), deps(missing)), 'USAGE')).toContain('不能为空')
    const long = '好'.repeat(501)
    expect(expectFail(await runAction(base({ text: long }), deps(missing)), 'USAGE')).toContain('500')
    expect(expectFail(await runAction(base({ kind: 'dm', text: 'x'.repeat(501) }), deps(missing)), 'USAGE')).toContain('500')
  })

  it('缺 target 报 USAGE', async () => {
    const bin = await fakeBin()
    expect(expectFail(await runAction(base({ target: '  ' }), deps(bin)), 'USAGE')).toContain('作品')
    expect(expectFail(await runAction(base({ kind: 'dm', target: '' }), deps(bin)), 'USAGE')).toContain('对方用户')
  })

  it('刚好 500 字是合法的', async () => {
    const bin = await fakeBin()
    const result = await runAction(base({ text: '好'.repeat(500) }), deps(bin))
    expect(result.ok).toBe(true)
  })
})

describe('action rate limit', () => {
  it('同平台同账号连续两次，第二次报 TOO_FAST 并给出剩余秒数', async () => {
    const bin = await fakeBin()
    let clock = 1_000
    const d = deps(bin, { now: () => clock })
    expect((await runAction(base({ target: 'i1' }), d)).ok).toBe(true)
    clock = 3_200 // 距上次只过了 2.2 秒
    expect(expectFail(await runAction(base({ target: 'i2' }), d), 'TOO_FAST')).toContain('0.8 秒')
    clock = 4_000 // 距第一次发起正好 3 秒
    expect((await runAction(base({ target: 'i3' }), d)).ok).toBe(true)
  })

  it('被限流不更新时间戳；不同账号互不影响', async () => {
    const bin = await fakeBin()
    let clock = 0
    const d = deps(bin, { now: () => clock })
    expect((await runAction(base({ account: 'acc1' }), d)).ok).toBe(true)
    clock = 1_500
    expect(expectFail(await runAction(base({ account: 'acc1' }), d), 'TOO_FAST')).toBeTruthy()
    clock = 2_500
    expect((await runAction(base({ account: 'acc2' }), d)).ok).toBe(true) // 另一个账号没被限流
    clock = 3_000
    expect((await runAction(base({ account: 'acc1' }), d)).ok).toBe(true) // 距 acc1 的 0ms 已满 3 秒
  })

  it('不同用户互不影响，同一用户的同一账号仍受限流约束', async () => {
    const bin = await fakeBin()
    let clock = 1_000
    const forUser = (home: string, over: Partial<ActionInput> = {}) =>
      deps(bin, { now: () => clock, env: { CATBUS_HOME: home }, ...over })

    expect((await runAction(base({ account: 'acc1', target: 'i1' }), forUser('/home/alice'))).ok).toBe(true)
    clock = 2_000
    // Bob 用了同名账号 acc1，但他是另一个用户，不该被 Alice 的限流挡住。
    expect((await runAction(base({ account: 'acc1', target: 'i2' }), forUser('/home/bob'))).ok).toBe(true)
    clock = 2_500
    expect(expectFail(await runAction(base({ account: 'acc1', target: 'i3' }), forUser('/home/alice')), 'TOO_FAST')).toBeTruthy()

    // 显式 user 与 CATBUS_HOME 都计入作用域：共用 home 时，不同 user 也彼此隔离。
    clock = 3_000
    expect((await runAction(base({ user: 'carol', account: 'acc1', target: 'i4' }), forUser('/home/shared'))).ok).toBe(true)
    clock = 3_500
    expect((await runAction(base({ user: 'dave', account: 'acc1', target: 'i5' }), forUser('/home/shared'))).ok).toBe(true)
    clock = 4_000
    expect(expectFail(await runAction(base({ user: 'carol', account: 'acc1', target: 'i6' }), forUser('/home/shared')), 'TOO_FAST')).toBeTruthy()
  })

  it('MEDIACRAWL_ACTION_INTERVAL_MS 和 deps.minIntervalMs 可以覆盖最小间隔', async () => {
    const bin = await fakeBin()
    setEnv('MEDIACRAWL_ACTION_INTERVAL_MS', '0')
    expect((await runAction(base({ target: 'i1' }), deps(bin))).ok).toBe(true)
    expect((await runAction(base({ target: 'i2' }), deps(bin))).ok).toBe(true)

    resetActionLimiter()
    setEnv('MEDIACRAWL_ACTION_INTERVAL_MS', '60000')
    expect((await runAction(base({ target: 'i3' }), deps(bin))).ok).toBe(true)
    expect(expectFail(await runAction(base({ target: 'i4' }), deps(bin)), 'TOO_FAST')).toBeTruthy()
    expect((await runAction(base({ target: 'i5' }), deps(bin, { minIntervalMs: 0 }))).ok).toBe(true) // deps 优先于 env
  })
})

describe('action failures come straight from the child', () => {
  it('风控 / 验证码：透传信封里的 code 和 message，不重试', async () => {
    const bin = await fakeBin({ ok: false, error: { code: 'RISK_CONTROL', message: 'slider captcha' } }, 5)
    expect(expectFail(await runAction(base(), deps(bin)), 'RISK_CONTROL')).toBe('slider captcha')
  })

  it('登录失效也原样返回', async () => {
    const bin = await fakeBin({ ok: false, error: { code: 'AUTH_EXPIRED', message: 'cookie expired' } }, 3)
    expect(expectFail(await runAction(base({ kind: 'dm', target: 'u1', text: 'hi' }), deps(bin)), 'AUTH_EXPIRED')).toBe('cookie expired')
  })

  it('没有信封就用 stderr，code 落回 UPSTREAM', async () => {
    const bin = await brokenBin()
    expect(expectFail(await runAction(base(), deps(bin)), 'UPSTREAM')).toContain('network down')
  })

  it('没有信封也没有 stderr 时报退出码', async () => {
    const bin = await fakeBin({ ok: true }, 9)
    expect(expectFail(await runAction(base(), deps(bin)), 'UPSTREAM')).toContain('退出码 9')
  })

  it('超时 kill 子进程并报 UPSTREAM', async () => {
    const bin = await slowBin()
    setEnv('MEDIACRAWL_ACTION_TIMEOUT_MS', '200')
    const result = await runAction(base(), { bin, now: () => 0 })
    expect(expectFail(result, 'UPSTREAM')).toContain('超时')
  })

  it('子进程拉不起来（入口不存在）也报 UPSTREAM', async () => {
    const bin = join(await tempDir('omc-action-missing-'), 'no-such-bin.mjs')
    expect(expectFail(await runAction(base(), deps(bin)), 'UPSTREAM')).toContain('Cannot find module')
  })
})
