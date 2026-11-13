#!/usr/bin/env node
/**
 * 补全已落盘的评论：按作品重拉「全部一级评论」，可选再拉每根评论下的回复。
 *
 * 只做增量：按 comment id 去重，已存在的记录原样保留（不覆盖属地等字段），新记录追加。
 * 默认干跑，加 --write 才落盘（先写 .bak）。
 *
 *   node scripts/backfill-comments.mjs --dir data/users/admin/douyin --platform douyin
 *   node scripts/backfill-comments.mjs --dir data/users/admin/douyin --platform douyin --replies --write
 *
 * 需要 CATBUS_HOME 指向该用户的登录态目录，且该账号已登录。
 */
import { execFile } from 'node:child_process'
import { readFile, readdir, copyFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
const pick = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const dirArg = pick('--dir', '')
const platform = pick('--platform', 'douyin')
const write = args.includes('--write')
const withReplies = args.includes('--replies')
const pause = Number(pick('--pause', '400'))
if (!dirArg || dirArg.startsWith('--')) {
  console.error('用法: node scripts/backfill-comments.mjs --dir <平台数据目录> [--platform douyin] [--replies] [--pause 400] [--write]')
  process.exit(2)
}
const dir = resolve(dirArg)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function cli(argv) {
  const { stdout } = await run(process.execPath, ['dist/cli/main.js', platform, ...argv, '-o', 'json'], { cwd: resolve('.'), maxBuffer: 256 * 1024 * 1024, env: process.env })
  const parsed = JSON.parse(stdout)
  if (parsed && parsed.ok === false) throw new Error(parsed.error?.message ?? '请求失败')
  const list = Array.isArray(parsed) ? parsed : parsed?.data
  if (!Array.isArray(list)) throw new Error('输出不是数组')
  return list
}

const files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl'))
const commentFile = files.find((name) => name.includes('comment'))
const itemFile = files.find((name) => name.includes('item'))
if (!commentFile || !itemFile) {
  console.error(`目录里需要 item 和 comment 两类 jsonl：${dir}`)
  process.exit(2)
}

const readJsonl = async (path) => {
  const text = await readFile(path, 'utf8')
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
  }
  return rows
}

const items = await readJsonl(join(dir, itemFile))
const existing = await readJsonl(join(dir, commentFile))
const byId = new Map(existing.map((row) => [String(row.id), row]))
const rootsMissingReplies = new Map()
for (const row of existing) if (!row.parent_id) rootsMissingReplies.set(String(row.id), row)
console.log(`已有评论 ${existing.length} 条（一级 ${[...byId.values()].filter((r) => !r.parent_id).length}），作品 ${items.length} 个；replies=${withReplies}，模式=${write ? '写入' : '干跑'}`)

let addedTop = 0
let addedReply = 0
let fetchedRoots = 0
let failed = 0

for (const item of items) {
  const itemId = String(item.id)
  let tops
  try {
    tops = await cli(['comment', 'list', itemId, '--all'])
  } catch (error) {
    failed++
    console.warn(`  跳过 ${itemId}：${String(error.message ?? error).slice(0, 120)}`)
    continue
  }
  await sleep(pause)
  for (const comment of tops) {
    const id = String(comment.id)
    if (!byId.has(id)) { byId.set(id, comment); addedTop++ }
    rootsMissingReplies.set(id, byId.get(id))
  }
  if (withReplies) {
    for (const root of tops) {
      const expected = Number(root.stats?.replies ?? 0)
      if (!expected) continue
      let replies
      try {
        replies = await cli(['comment', 'replies', itemId, String(root.id), '--all'])
        fetchedRoots++
      } catch (error) {
        console.warn(`  回复 ${root.id} 跳过：${String(error.message ?? error).slice(0, 100)}`)
        continue
      }
      await sleep(pause)
      for (const reply of replies) {
        const id = String(reply.id)
        if (!byId.has(id)) { byId.set(id, reply); addedReply++ }
      }
      const have = [...byId.values()].filter((row) => String(row.parent_id ?? '') === String(root.id)).length
      if (have < expected) console.warn(`  ${root.id} 期望 ${expected} 条回复，实际拿到 ${have}`)
    }
  }
  process.stdout.write('.')
}
process.stdout.write('\n')

const total = byId.size
console.log(`拉取作品 ${items.length - failed}/${items.length}；新增一级 ${addedTop}，新增回复 ${addedReply}（拉过回复的根评论 ${fetchedRoots}）；合计 ${total} 条`)
if (!write) {
  console.log('干跑结束，没有改文件。加 --write 落盘。')
  process.exit(0)
}
if (!addedTop && !addedReply) {
  console.log('没有新增，不动文件。')
  process.exit(0)
}
const target = join(dir, commentFile)
await copyFile(target, `${target}.bak`)
await writeFile(target, [...byId.values()].map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
console.log(`写入 ${target}（备份 ${target}.bak）`)
