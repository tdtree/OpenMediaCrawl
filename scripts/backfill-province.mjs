#!/usr/bin/env node
/**
 * 给已落盘的评论补 IP 属地（province）。
 *
 * 只做一件事：按 item_id 重新拉一遍一级评论，用返回的 ip_label 回填同 id 的本地记录。
 * 不新增、不删除、不改其它字段；默认干跑，加 --write 才落盘（先写 .bak）。
 *
 *   node scripts/backfill-province.mjs --dir data/users/admin/douyin
 *   node scripts/backfill-province.mjs --dir data/users/admin/douyin --write
 *
 * 需要 CATBUS_HOME 指向该用户的登录态目录，且该账号已登录。
 */
import { execFile } from 'node:child_process'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
const dirArg = args[args.indexOf('--dir') + 1]
const platform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : 'douyin'
const write = args.includes('--write')
const limit = args.includes('--limit') ? args[args.indexOf('--limit') + 1] : '200'
if (!dirArg || dirArg.startsWith('--')) {
  console.error('用法: node scripts/backfill-province.mjs --dir <平台数据目录> [--platform douyin] [--limit 200] [--write]')
  process.exit(2)
}
const dir = resolve(dirArg)

const files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl') && name.includes('comment'))
if (!files.length) {
  console.error(`目录里没有 comment jsonl：${dir}`)
  process.exit(2)
}

async function fetchList(argv) {
  const { stdout } = await run(process.execPath, ['dist/cli/main.js', ...argv, '-o', 'json'], { cwd: resolve('.'), maxBuffer: 64 * 1024 * 1024, env: process.env })
  const parsed = JSON.parse(stdout)
  if (parsed && parsed.ok === false) throw new Error(parsed.error?.message ?? '请求失败')
  const list = Array.isArray(parsed) ? parsed : parsed?.data
  if (!Array.isArray(list)) throw new Error('输出不是数组')
  return list
}

const rows = []
for (const name of files) {
  const text = await readFile(join(dir, name), 'utf8')
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { rows.push({ file: join(dir, name), data: JSON.parse(line) }) } catch { /* 坏行不碰 */ }
  }
}
const byItem = new Map()
for (const row of rows) {
  const id = row.data.item_id
  if (!id) continue
  const list = byItem.get(id) ?? []
  list.push(row)
  byItem.set(id, list)
}
console.log(`评论 ${rows.length} 条，涉及作品 ${byItem.size} 个；模式=${write ? '写入' : '干跑'}，platform=${platform}`)

let fetched = 0
let matched = 0
let withProvince = 0

for (const [itemId, list] of byItem) {
  let comments
  try {
    comments = await fetchList([platform, 'comment', 'list', itemId, '--limit', limit])
  } catch (error) {
    console.warn(`  跳过 ${itemId}：${String(error.message ?? error).slice(0, 160)}`)
    continue
  }
  fetched++
  const province = new Map()
  for (const c of comments) if (c?.id && c.province) province.set(String(c.id), c.province)
  for (const row of list) {
    if (row.data.province) { withProvince++; continue }
    const value = province.get(String(row.data.id))
    if (!value) continue
    row.data.province = value
    matched++
  }
  const parents = new Set(list.filter((row) => !row.data.province && row.data.parent_id).map((row) => String(row.data.parent_id)))
  for (const parent of parents) {
    try {
      const replies = await fetchList([platform, 'comment', 'replies', itemId, parent, '--limit', limit])
      const map = new Map()
      for (const c of replies) if (c?.id && c.province) map.set(String(c.id), c.province)
      for (const row of list) {
        if (row.data.province) continue
        const value = map.get(String(row.data.id))
        if (!value) continue
        row.data.province = value
        matched++
      }
      process.stdout.write('+')
    } catch (error) {
      console.warn(`  楼中楼 ${parent} 跳过：${String(error.message ?? error).slice(0, 120)}`)
    }
  }
  process.stdout.write('.')
}
process.stdout.write('\n')

console.log(`拉取成功 ${fetched}/${byItem.size} 个作品；本地原有属地 ${withProvince} 条；可回填 ${matched} 条`)
if (!write) {
  console.log('干跑结束，没有改动任何文件。加 --write 落盘。')
  process.exit(0)
}
if (!matched) {
  console.log('没有可回填的，不动文件。')
  process.exit(0)
}

const touched = new Set(rows.map((row) => row.file))
for (const file of touched) {
  await copyFile(file, `${file}.bak`)
  const text = rows.filter((row) => row.file === file).map((row) => JSON.stringify(row.data)).join('\n') + '\n'
  await writeFile(file, text, 'utf8')
  console.log(`写入 ${file}（备份 ${file}.bak）`)
}
