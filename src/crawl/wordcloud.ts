import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { readStoredRecords } from './storage.js'

const STOPWORDS = new Set(
  ('的 了 和 是 在 我 有 也 就 都 而 及 与 这 那 一个 没有 你 我们 他们 以及 对 于 被 很 更 最 还 吗 吧 啊 呢 哈哈 哈哈哈 什么 怎么 这个 那个 就是 不是 可以 真的 还是 但是 因为 所以 如果 自己 一下 一样 知道 觉得 现在 已经 可能 时候 很好 很高 很快 很多 非常 特别 the and for you that this with are was have').split(' '),
)

async function textsFrom(path: string): Promise<string[]> {
  if (path.endsWith('.csv')) return (await readStoredRecords(path)).map((r) => String((r.data as { text?: unknown })?.text ?? ''))
  const raw = await readFile(path, 'utf8')
  const pick = (v: unknown) => String((v as { text?: unknown })?.text ?? '')
  if (path.endsWith('.jsonl')) return raw.split(/\r?\n/).filter(Boolean).map((line) => pick(JSON.parse(line)))
  const value = JSON.parse(raw) as unknown
  return (Array.isArray(value) ? value : [value]).map(pick)
}

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

/**
 * Dictionary-based Chinese word segmentation via the ICU data bundled with Node (`Intl.Segmenter`),
 * so no native segmenter or Python is needed. Latin words are lower-cased.
 */
export function tokenize(text: string): string[] {
  const words: string[] = []
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) continue
    const word = /[A-Za-z]/.test(part.segment) ? part.segment.toLowerCase() : part.segment
    if (word.length > 1 && !/^\d+$/.test(word) && !STOPWORDS.has(word)) words.push(word)
  }
  return words
}

export function countWords(texts: string[], top = 150): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const text of texts) for (const token of new Set(tokenize(text))) counts.set(token, (counts.get(token) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top)
}

interface Box { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** Writes a PNG word cloud (Archimedean spiral placement). Falls back to a TSV frequency table if canvas is unavailable. */
export async function generateWordCloud(input: string, output: string, size = { width: 1600, height: 1000 }): Promise<{ words: number; output: string; format: 'png' | 'tsv' }> {
  const words = countWords(await textsFrom(input))
  try {
    const { createCanvas } = createRequire(import.meta.url)('@napi-rs/canvas') as { createCanvas: (w: number, h: number) => any }
    const { width, height } = size
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, width, height)
    ctx.textBaseline = 'top'
    const max = words[0]?.[1] ?? 1
    const placed: Box[] = []
    words.forEach(([word, count], index) => {
      const fontSize = Math.round(16 + 84 * Math.sqrt(count / max))
      ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`
      const w = ctx.measureText(word).width + 6
      const h = fontSize * 1.1
      for (let t = 0; t < 2400; t += 0.35) {
        const r = 4 * t
        const box = { x: width / 2 + r * Math.cos(t) * 1.4 - w / 2, y: height / 2 + r * Math.sin(t) - h / 2, w, h }
        if (box.x < 0 || box.y < 0 || box.x + w > width || box.y + h > height) { if (r > width) break; continue }
        if (placed.some((p) => overlaps(p, box))) continue
        placed.push(box)
        ctx.fillStyle = `hsl(${(index * 137.5) % 360} 75% ${62 + (index % 3) * 6}%)`
        ctx.fillText(word, box.x + 3, box.y)
        break
      }
    })
    await writeFile(output, canvas.toBuffer('image/png'))
    return { words: words.length, output, format: 'png' }
  } catch {
    await writeFile(output, words.map(([w, c]) => `${w}\t${c}`).join('\n') + '\n', 'utf8')
    return { words: words.length, output, format: 'tsv' }
  }
}
