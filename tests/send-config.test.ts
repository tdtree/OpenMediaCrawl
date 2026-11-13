import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SEND_CONFIG, loadSendConfig, normalizeSendConfig, saveSendConfig, sendConfigPath } from '../src/crawl/send-config.js'

const dirs: string[] = []
const saveHome = process.env.OMC_HOME
const saveFile = process.env.OMC_USERS_FILE

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omc-send-'))
  dirs.push(dir)
  process.env.OMC_HOME = dir
  delete process.env.OMC_USERS_FILE
})
afterEach(async () => {
  if (saveHome === undefined) delete process.env.OMC_HOME
  else process.env.OMC_HOME = saveHome
  if (saveFile === undefined) delete process.env.OMC_USERS_FILE
  else process.env.OMC_USERS_FILE = saveFile
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('群发参数', () => {
  it('默认 25 条/天、一次 50 条、间隔 30-90 秒', async () => {
    expect(DEFAULT_SEND_CONFIG).toEqual({ dailyCap: 25, batchMax: 50, minSeconds: 30, maxSeconds: 90 })
    expect(await loadSendConfig()).toEqual(DEFAULT_SEND_CONFIG)
  })

  it('和 users.json 同目录，保存后能读回', async () => {
    const saved = await saveSendConfig({ dailyCap: 40, batchMax: 80, minSeconds: 45, maxSeconds: 120 })
    expect(saved).toEqual({ dailyCap: 40, batchMax: 80, minSeconds: 45, maxSeconds: 120 })
    expect(sendConfigPath()).toBe(join(process.env.OMC_HOME!, 'send-config.json'))
    expect(JSON.parse(await readFile(sendConfigPath(), 'utf8'))).toMatchObject({ dailyCap: 40, batchMax: 80 })
    expect(await loadSendConfig()).toEqual(saved)
  })

  it('越界值收敛，最大间隔不小于最小间隔', () => {
    expect(normalizeSendConfig({ dailyCap: 0, batchMax: 999, minSeconds: 1, maxSeconds: 2 })).toEqual({
      dailyCap: 1, batchMax: 200, minSeconds: 5, maxSeconds: 5,
    })
    expect(normalizeSendConfig({ minSeconds: 100, maxSeconds: 50 }, { dailyCap: 25, batchMax: 50, minSeconds: 30, maxSeconds: 90 }))
      .toEqual({ dailyCap: 25, batchMax: 50, minSeconds: 100, maxSeconds: 100 })
    expect(normalizeSendConfig({ dailyCap: Number.NaN })).toEqual(DEFAULT_SEND_CONFIG)
  })
})
