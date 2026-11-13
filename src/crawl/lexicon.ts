import { join } from 'node:path'
import { readTextIfExists, writeFileAtomic } from '../core/fsutil.js'

/** 每个用户一套词库：搜索关键词 + 评论筛选词。 */
export interface Lexicon {
  keywords: string[]
  filters: string[]
}

const MAX_ITEMS = 300
const MAX_LEN = 40
const file = (root: string) => join(root, 'lexicon.json')

/** 空格、斜杠、逗号、顿号、分号都当分隔符；去掉空项和首尾空白。 */
export function splitTerms(text: string): string[] {
  return String(text ?? '')
    .split(/[\s\/,，、;；|]+/)
    .map((term) => term.trim())
    .filter(Boolean)
}

function clean(list: unknown): string[] {
  const source = Array.isArray(list) ? list : typeof list === 'string' ? splitTerms(list) : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of source) {
    const value = String(raw ?? '').trim().slice(0, MAX_LEN)
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

export type LexiconInput = { keywords?: string[] | string; filters?: string[] | string }

export function sanitizeLexicon(input: LexiconInput | null | undefined): Lexicon {
  return { keywords: clean(input?.keywords), filters: clean(input?.filters) }
}

export async function loadLexicon(root: string): Promise<Lexicon> {
  const raw = await readTextIfExists(file(root))
  if (!raw) return { keywords: [], filters: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<Lexicon>
    return sanitizeLexicon(parsed)
  } catch {
    // 坏文件按空词库处理，下一次保存会覆盖；不抛错，免得整个页面打不开
    return { keywords: [], filters: [] }
  }
}

export async function saveLexicon(root: string, input: LexiconInput): Promise<Lexicon> {
  const next = sanitizeLexicon(input)
  await writeFileAtomic(file(root), JSON.stringify(next, null, 2) + '\n')
  return next
}
