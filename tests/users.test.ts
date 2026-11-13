import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import {
  changePassword,
  checkUsername,
  createUser,
  ensureAdmin,
  listUsers,
  removeUser,
  setRole,
  usersFilePath,
  verifyUser,
} from '../src/crawl/users.js'
import type { Role, User } from '../src/crawl/users.js'
import {
  SESSION_COOKIE,
  createSession,
  dropSession,
  dropUserSessions,
  parseCookieHeader,
  readSession,
  sessionCookie,
} from '../src/crawl/sessions.js'

// 每个用例一个独立临时目录，并把三个相关环境变量恢复原样
let dir = ''
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ['OMC_USERS_FILE', 'OMC_HOME', 'OMC_ADMIN_PASSWORD']) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  dir = mkdtempSync(join(tmpdir(), 'omc-users-'))
  process.env.OMC_USERS_FILE = join(dir, 'users.json')
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(dir, { recursive: true, force: true })
})

const PASSWORD = 'password123'

async function makeUser(username: string, password = PASSWORD, role?: Role): Promise<User> {
  return createUser({ username, password, role })
}

/** 断言 promise 抛出 CatbusError，并检查 code 与消息片段。 */
async function expectCatbusError(promise: Promise<unknown>, code: string, message?: string): Promise<CatbusError> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  )
  expect(error).toBeInstanceOf(CatbusError)
  const typed = error as CatbusError
  expect(typed.code).toBe(code)
  if (message !== undefined) expect(typed.message).toContain(message)
  return typed
}

describe('users', () => {
  it('usersFilePath 优先 OMC_USERS_FILE，否则落在 OMC_HOME 下', () => {
    expect(usersFilePath()).toBe(join(dir, 'users.json'))
    const explicit = process.env.OMC_USERS_FILE
    delete process.env.OMC_USERS_FILE
    process.env.OMC_HOME = join(dir, 'home')
    expect(usersFilePath()).toBe(join(dir, 'home', 'users.json'))
    process.env.OMC_USERS_FILE = explicit
    delete process.env.OMC_HOME
  })

  it('文件不存在时 listUsers 为空列表', async () => {
    expect(await listUsers()).toEqual([])
  })

  it('创建用户后能用正确密码验证，错误密码/未知用户返回 null', async () => {
    const user = await makeUser('zhangsan')
    expect(user.username).toBe('zhangsan')
    expect(user.role).toBe('user')
    expect(user.password_hash).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(user.password_hash).not.toContain(PASSWORD)
    expect(Number.isNaN(Date.parse(user.created_at))).toBe(false)

    const verified = await verifyUser('zhangsan', PASSWORD)
    expect(verified?.username).toBe('zhangsan')
    expect(verified?.role).toBe('user')
    // 返回值不应该是内部对象引用
    expect(verified).not.toBe(user)

    expect(await verifyUser('zhangsan', 'password124')).toBeNull()
    expect(await verifyUser('zhangsan', '')).toBeNull()
    expect(await verifyUser('nobody', PASSWORD)).toBeNull()
    // 用户名不合法时也返回 null，不抛错
    expect(await verifyUser('ZHANG', PASSWORD)).toBeNull()
  })

  it('重名拒绝', async () => {
    await makeUser('lisi')
    await expectCatbusError(makeUser('lisi'), 'USAGE', '用户已存在')
    expect((await listUsers()).length).toBe(1)
  })

  it('非法用户名抛 USAGE', async () => {
    const bad = ['ab', 'a', '', 'A_bc', '-abc', 'abc def', '张', 'a'.repeat(33)]
    for (const username of bad) {
      expect(() => checkUsername(username)).toThrow(CatbusError)
      await expectCatbusError(makeUser(username), 'USAGE')
    }
    // 边界上的合法名字
    expect(checkUsername('abc')).toBe('abc')
    expect(checkUsername(' a_1-2 ')).toBe('a_1-2')
    expect(checkUsername('a'.repeat(32))).toBe('a'.repeat(32))
    // 真实姓名：2-30 位中文，可用间隔号
    expect(checkUsername('张三')).toBe('张三')
    expect(checkUsername(' 阿依古丽·买买提 ')).toBe('阿依古丽·买买提')
    const user = await makeUser('z'.repeat(32), 'password123')
    expect(user.username.length).toBe(32)
  })

  it('密码长度限制 8-128 位', async () => {
    await expectCatbusError(makeUser('shortpw', '1234567'), 'USAGE', '密码长度')
    await expectCatbusError(makeUser('longpw', 'x'.repeat(129)), 'USAGE', '密码长度')
    // 正好 8 位和 128 位都可以
    expect((await makeUser('eight', '12345678')).username).toBe('eight')
    expect((await makeUser('maxlen', 'y'.repeat(128))).username).toBe('maxlen')
    expect((await verifyUser('maxlen', 'y'.repeat(128)))?.username).toBe('maxlen')
  })

  it('改密码后旧密码失效、新密码生效', async () => {
    await makeUser('wangwu')
    const before = (await listUsers())[0].password_hash
    await changePassword('wangwu', 'newpassword')
    const after = (await listUsers())[0].password_hash
    expect(after).not.toBe(before)
    expect(await verifyUser('wangwu', PASSWORD)).toBeNull()
    expect((await verifyUser('wangwu', 'newpassword'))?.username).toBe('wangwu')
    // 密码太短 / 用户不存在
    await expectCatbusError(changePassword('wangwu', 'short'), 'USAGE', '密码长度')
    await expectCatbusError(changePassword('ghost', 'newpassword'), 'USAGE', '用户不存在')
  })

  it('setRole 改角色，但不许降级最后一个 admin', async () => {
    await makeUser('boss', PASSWORD, 'admin')
    await makeUser('worker')
    const promoted = await setRole('worker', 'admin')
    expect(promoted.role).toBe('admin')
    expect((await setRole('worker', 'user')).role).toBe('user')
    // 现在只剩 boss 一个 admin，降级被拒
    await expectCatbusError(setRole('boss', 'user'), 'USAGE', '至少要保留一个 admin')
    expect((await listUsers()).find((u) => u.username === 'boss')?.role).toBe('admin')
    await expectCatbusError(setRole('ghost', 'admin'), 'USAGE', '用户不存在')
    // 非法角色（绕过类型）
    await expectCatbusError(setRole('worker', 'root' as Role), 'USAGE', '未知角色')
  })

  it('removeUser 删普通用户，但不许删最后一个 admin', async () => {
    await makeUser('boss', PASSWORD, 'admin')
    await makeUser('worker')
    await removeUser('worker')
    expect((await listUsers()).map((u) => u.username)).toEqual(['boss'])
    await expectCatbusError(removeUser('boss'), 'USAGE', '至少要保留一个 admin')
    expect((await listUsers()).length).toBe(1)
    await expectCatbusError(removeUser('ghost'), 'USAGE', '用户不存在')
    // 有两个 admin 时可以删掉其中一个
    await makeUser('boss2', PASSWORD, 'admin')
    await removeUser('boss2')
    expect((await listUsers()).map((u) => u.username)).toEqual(['boss'])
  })

  it('ensureAdmin 只在首次创建，尊重 OMC_ADMIN_PASSWORD', async () => {
    process.env.OMC_ADMIN_PASSWORD = 'configured-password'
    const first = await ensureAdmin()
    expect(first).toEqual({ created: true, username: 'admin', password: 'configured-password' })
    expect((await listUsers())[0]).toMatchObject({ username: 'admin', role: 'admin' })
    expect((await verifyUser('admin', 'configured-password'))?.role).toBe('admin')

    const second = await ensureAdmin()
    expect(second).toEqual({ created: false, username: 'admin' })
    expect(second.password).toBeUndefined()
    expect((await listUsers()).length).toBe(1)
  })

  it('ensureAdmin 没给密码时生成 12 位随机密码，且能登录', async () => {
    const result = await ensureAdmin()
    expect(result.created).toBe(true)
    expect(result.password).toMatch(/^[A-Za-z0-9]{12}$/)
    expect((await verifyUser('admin', result.password as string))?.username).toBe('admin')
    // 已有普通用户时不再创建 admin（按约定用户列表非空即视为非首次）
    rmSync(usersFilePath(), { force: true })
    await makeUser('someone')
    expect(await ensureAdmin()).toEqual({ created: false, username: 'admin' })
    expect((await listUsers()).map((u) => u.username)).toEqual(['someone'])
  })

  it('ensureAdmin 对过短的 OMC_ADMIN_PASSWORD 报错而不是静默换密码', async () => {
    process.env.OMC_ADMIN_PASSWORD = 'short'
    await expectCatbusError(ensureAdmin(), 'USAGE', '密码长度')
  })

  it('每次读写都重新读文件（不缓存），并能看到外部修改', async () => {
    await makeUser('first')
    const onDisk = JSON.parse(readFileSync(usersFilePath(), 'utf8')) as { version: number; users: User[] }
    expect(onDisk.version).toBe(1)
    expect(onDisk.users.map((u) => u.username)).toEqual(['first'])
    onDisk.users.push({
      username: 'second',
      role: 'user',
      status: 'active',
      password_hash: onDisk.users[0].password_hash,
      created_at: onDisk.users[0].created_at,
    })
    writeFileSync(usersFilePath(), JSON.stringify(onDisk))
    expect((await listUsers()).map((u) => u.username)).toEqual(['first', 'second'])
  })

  // 损坏的 users.json：这里选择抛 CatbusError('ERROR')（消息「用户数据文件损坏」），
  // 而不是当成空列表——否则下一次写入会覆盖掉还能人工修复的数据。
  it('损坏的 users.json 抛可识别的 CatbusError', async () => {
    writeFileSync(usersFilePath(), '{ this is not json')
    await expectCatbusError(listUsers(), 'ERROR', '用户数据文件损坏')
    await expectCatbusError(makeUser('someone'), 'ERROR', '用户数据文件损坏')

    writeFileSync(usersFilePath(), JSON.stringify({ version: 1, users: [{ username: 42 }] }))
    await expectCatbusError(listUsers(), 'ERROR', '用户数据文件损坏')
  })

  it('哈希被改坏时 verifyUser 返回 null 而不是抛错', async () => {
    await makeUser('broken')
    const data = JSON.parse(readFileSync(usersFilePath(), 'utf8')) as { version: number; users: User[] }
    for (const bad of ['', 'plain-text-hash', 'scrypt$16384$8$1$zz$zz', 'md5$1$2$3$aa$bb']) {
      data.users[0].password_hash = bad
      writeFileSync(usersFilePath(), JSON.stringify(data))
      expect(await verifyUser('broken', PASSWORD)).toBeNull()
    }
  })
})

describe('sessions', () => {
  it('会话创建/读取/删除，token 是 32 字节 base64url', () => {
    let now = 1_000
    const token = createSession('alice', { now: () => now })
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(readSession(token)).toEqual({ username: 'alice', created_at: 1_000 })
    expect(readSession('not-a-token')).toBeNull()
    expect(readSession('')).toBeNull()

    now = 2_000
    const second = createSession('alice', { now: () => now })
    expect(readSession(second)).toEqual({ username: 'alice', created_at: 2_000 })

    dropSession(token)
    expect(readSession(token)).toBeNull()
    expect(readSession(second)?.username).toBe('alice')
    // 删不存在的 token 不报错
    expect(() => dropSession(token)).not.toThrow()
  })

  it('dropUserSessions 只清掉该用户的会话', () => {
    const a1 = createSession('bob')
    const a2 = createSession('bob')
    const other = createSession('carol')
    dropUserSessions('bob')
    expect(readSession(a1)).toBeNull()
    expect(readSession(a2)).toBeNull()
    expect(readSession(other)?.username).toBe('carol')
    // 没有该用户的会话时也不报错
    expect(() => dropUserSessions('nobody')).not.toThrow()
    dropSession(other)
  })

  it('parseCookieHeader 处理常见形态', () => {
    expect(parseCookieHeader('a=1; b=2')).toEqual({ a: '1', b: '2' })
    expect(parseCookieHeader(undefined)).toEqual({})
    expect(parseCookieHeader('')).toEqual({})
    expect(parseCookieHeader('omc_session=abc123')).toEqual({ omc_session: 'abc123' })
    expect(parseCookieHeader(' omc_session = abc123 ; x=1 ')).toEqual({ omc_session: 'abc123', x: '1' })
    // 没有 = 的片段跳过
    expect(parseCookieHeader('flag; a=1')).toEqual({ a: '1' })
    // 同名键后者覆盖前者
    expect(parseCookieHeader('a=1; a=2')).toEqual({ a: '2' })
    // 带引号的值
    expect(parseCookieHeader('q="a b"; a=1')).toEqual({ q: 'a b', a: '1' })
    // 百分号编码：能解就解，解不开保留原文
    expect(parseCookieHeader('n=%E4%B8%AD')).toEqual({ n: '中' })
    expect(parseCookieHeader('bad=%E4')).toEqual({ bad: '%E4' })
  })

  it('sessionCookie 生成合规的 Set-Cookie 值', () => {
    expect(SESSION_COOKIE).toBe('omc_session')
    expect(sessionCookie('abc')).toBe('omc_session=abc; HttpOnly; Path=/; SameSite=Lax; Max-Age=315360000')
    expect(sessionCookie('abc', 60)).toBe('omc_session=abc; HttpOnly; Path=/; SameSite=Lax; Max-Age=60')
    expect(sessionCookie('abc', 0)).toBe('omc_session=abc; HttpOnly; Path=/; SameSite=Lax; Max-Age=0')
    // 生成的值能被自己的解析器读回来
    const token = createSession('dave')
    const header = sessionCookie(token).split(';')[0]
    expect(parseCookieHeader(header)[SESSION_COOKIE]).toBe(token)
    dropSession(token)
  })
})
