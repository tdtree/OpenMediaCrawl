import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSession, dropSession, dropUserSessions, readSession, restoreSessions } from '../src/crawl/sessions.js'

const dirs: string[] = []
async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omc-session-'))
  dirs.push(dir)
  return join(dir, 'sessions.json')
}
afterEach(async () => {
  restoreSessions(null)
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('会话落盘', () => {
  it('重启后原 cookie 仍然有效', async () => {
    const file = await tempFile()
    restoreSessions(file)
    const token = createSession('alice')
    expect(readSession(token)?.username).toBe('alice')

    // 模拟进程重启：清空内存，从文件读回
    restoreSessions(file)
    expect(readSession(token)?.username).toBe('alice')
    expect(JSON.parse(await readFile(file, 'utf8'))[token]).toMatchObject({ username: 'alice' })
  })

  it('过期会话不恢复；登出/停用会写回文件', async () => {
    const file = await tempFile()
    const old = Date.now() - 8 * 24 * 3600 * 1000
    await writeFile(file, JSON.stringify({
      stale: { username: 'bob', created_at: old },
      live: { username: 'carol', created_at: Date.now() },
    }), 'utf8')
    restoreSessions(file)
    expect(readSession('stale')).toBeNull()
    expect(readSession('live')?.username).toBe('carol')

    const token = createSession('dave')
    dropSession(token)
    restoreSessions(file)
    expect(readSession(token)).toBeNull()

    const two = createSession('erin')
    dropUserSessions('erin')
    restoreSessions(file)
    expect(readSession(two)).toBeNull()
    expect(readSession('live')?.username).toBe('carol')
  })
})
