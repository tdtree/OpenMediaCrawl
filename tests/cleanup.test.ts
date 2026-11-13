import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addFilterTerms, applyCleanup, effectiveTerms, planCleanup } from '../src/crawl/cleanup.js'
import { saveLexicon } from '../src/crawl/lexicon.js'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omc-clean-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const old = '2025-01-01T10:00:00+08:00'
const fresh = new Date().toISOString()

async function seed(root: string, rows: Array<Record<string, unknown>>): Promise<string> {
  const dir = join(root, 'douyin')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'search_comment_2026-01-01.jsonl')
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  return file
}

describe('数据清理', () => {
  it('只挑「超过 N 天且没被筛选词命中」的评论，缺时间的跳过', async () => {
    const root = await tempDir()
    await saveLexicon(root, { keywords: [], filters: ['消防'] })
    await seed(root, [
      { id: 'c1', item_id: 'i1', text: '消防设计多少钱', created_at: old },
      { id: 'c2', item_id: 'i1', text: '路过看看', created_at: old },
      { id: 'c3', item_id: 'i1', text: '路过看看', created_at: fresh },
      { id: 'c4', item_id: 'i1', text: '没有时间字段' },
    ])

    const plan = await planCleanup(root, { days: 30, now: Date.now() })
    expect(plan.terms).toEqual(['消防'])
    expect(plan.total).toBe(4)
    expect(plan.candidates.map((one) => one.id)).toEqual(['c2'])
    expect(plan.skipped).toBe(1)
  })

  it('历史用过的筛选词也算数；清掉的评论不再被选中', async () => {
    const root = await tempDir()
    await saveLexicon(root, { keywords: [], filters: [] })
    await addFilterTerms(root, ['贷款', ' 贷款 ', '价格'])
    expect(await effectiveTerms(root)).toEqual(['贷款', '价格'])
    await seed(root, [
      { id: 'a', text: '想做贷款', created_at: old },
      { id: 'b', text: '随便说说', created_at: old },
    ])
    const plan = await planCleanup(root, { days: 30 })
    expect(plan.candidates.map((one) => one.id)).toEqual(['b'])
  })

  it('执行后删掉候选行、保留其它行与断点状态，并留 .bak', async () => {
    const root = await tempDir()
    await saveLexicon(root, { keywords: [], filters: ['留下'] })
    const file = await seed(root, [
      { id: 'c1', text: '留下', created_at: old },
      { id: 'c2', text: '删掉', created_at: old },
    ])
    const stateFile = join(root, '.crawl-state-douyin-search.json')
    await writeFile(stateFile, JSON.stringify({ items: [], comments: ['c1', 'c2'], finished: true }), 'utf8')

    const plan = await planCleanup(root, { days: 30 })
    const result = await applyCleanup(plan)
    expect(result.removed).toBe(1)

    const left = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { id: string })
    expect(left.map((row) => row.id)).toEqual(['c1'])
    expect(await readFile(`${file}.bak`, 'utf8')).toContain('c2')
    // 断点状态不动：重跑采集仍会跳过这两条
    expect(await readFile(stateFile, 'utf8')).toContain('c2')
  })
})
